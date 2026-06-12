/**
 * Custom lightweight MIME parser for incoming emails
 * Handles header decoding, multipart body boundary splitting, and
 * Quoted-Printable / Base64 transfer decoding.
 */

export interface MailPart {
  headers: Record<string, string>;
  body: string;
  contentType: string;
  parts: MailPart[];
}

export interface ParsedEmail {
  from: string;
  to: string;
  subject: string;
  date: Date;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/**
 * Decodes quoted-printable encoded strings, handling UTF-8 characters properly.
 */
export function decodeQuotedPrintable(str: string): string {
  // Soft line breaks: =\r\n or =\n
  str = str.replace(/=\r?\n/g, "");

  // Use a buffer to decode byte-by-byte for correct UTF-8 multi-byte decoding
  const buffer = Buffer.alloc(str.length);
  let bufIdx = 0;

  for (let i = 0; i < str.length; i++) {
    if (str[i] === "=" && i + 2 < str.length) {
      const hex = str.substring(i + 1, i + 3);
      if (/^[0-9A-F]{2}$/i.test(hex)) {
        buffer[bufIdx++] = parseInt(hex, 16);
        i += 2;
        continue;
      }
    }
    buffer[bufIdx++] = str.charCodeAt(i);
  }

  return buffer.subarray(0, bufIdx).toString("utf-8");
}

/**
 * Decodes RFC 2047 encoded-words (e.g., =?UTF-8?B?cG9vbA==?=) in email headers.
 */
export function decodeHeader(headerStr: string): string {
  if (!headerStr) return "";
  
  // Unfold folded lines inside header value first
  const unfolded = headerStr.replace(/\r?\n[ \t]+/g, " ");

  return unfolded.replace(/=\?([^?]+)\?([QB])\?([^?]*)\?=/gi, (match, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === "B") {
        return Buffer.from(text, "base64").toString("utf-8");
      } else if (encoding.toUpperCase() === "Q") {
        // Q encoding is similar to quoted-printable but underscores represent spaces
        const qText = text.replace(/_/g, " ");
        return decodeQuotedPrintable(qText);
      }
    } catch (e) {
      console.error("[MIME] Error decoding header word:", e);
    }
    return match;
  });
}

/**
 * Extract the boundary parameter from a Content-Type header value
 */
function getBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=["']?([^"';\s]+)["']?/i);
  return match ? match[1] : null;
}

/**
 * Find the boundary between headers and body (first empty line)
 */
function findDoubleNewline(str: string): number {
  let idx = str.indexOf("\r\n\r\n");
  if (idx !== -1) return idx;
  idx = str.indexOf("\n\n");
  if (idx !== -1) return idx;
  idx = str.indexOf("\r\n\n");
  if (idx !== -1) return idx;
  idx = str.indexOf("\n\r\n");
  return idx;
}

/**
 * Recursively parse email raw data into MailPart objects
 */
export function parsePart(rawPart: string): MailPart {
  const doubleNewlineIndex = findDoubleNewline(rawPart);
  let headersStr = "";
  let bodyStr = "";

  if (doubleNewlineIndex === -1) {
    bodyStr = rawPart;
  } else {
    headersStr = rawPart.substring(0, doubleNewlineIndex);
    bodyStr = rawPart.substring(doubleNewlineIndex);
    
    // Skip the delimiter newlines
    if (bodyStr.startsWith("\r\n\r\n")) {
      bodyStr = bodyStr.substring(4);
    } else if (bodyStr.startsWith("\n\n")) {
      bodyStr = bodyStr.substring(2);
    } else if (bodyStr.startsWith("\r\n\n") || bodyStr.startsWith("\n\r\n")) {
      bodyStr = bodyStr.substring(3);
    }
  }

  // Parse headers
  const unfoldedHeaders = headersStr.replace(/\r?\n[ \t]+/g, " ");
  const headerLines = unfoldedHeaders.split(/\r?\n/);
  const headers: Record<string, string> = {};
  
  for (const line of headerLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const val = line.substring(colonIdx + 1).trim();
      headers[key] = val;
    }
  }

  const contentType = headers["content-type"] || "text/plain";
  const contentTransferEncoding = (headers["content-transfer-encoding"] || "").toLowerCase().trim();

  let decodedBody = bodyStr;
  const boundary = getBoundary(contentType);
  const parts: MailPart[] = [];

  if (boundary) {
    const boundaryDelimiter = `--${boundary}`;
    // Split by boundary
    const rawParts = bodyStr.split(boundaryDelimiter);
    
    for (let i = 1; i < rawParts.length; i++) {
      const rawSubPart = rawParts[i];
      // Check if this is the closing boundary (--boundary--)
      if (rawSubPart.startsWith("--") || !rawSubPart.trim()) {
        continue;
      }
      
      // Clean leading CRLF or LF of the subpart
      let cleanSubPart = rawSubPart;
      if (cleanSubPart.startsWith("\r\n")) {
        cleanSubPart = cleanSubPart.substring(2);
      } else if (cleanSubPart.startsWith("\n")) {
        cleanSubPart = cleanSubPart.substring(1);
      }
      
      parts.push(parsePart(cleanSubPart));
    }
  } else {
    // Leaf part, apply transfer decoding
    if (contentTransferEncoding === "base64") {
      try {
        const cleanBase64 = bodyStr.replace(/\s+/g, "");
        decodedBody = Buffer.from(cleanBase64, "base64").toString("utf-8");
      } catch (e) {
        console.error("[MIME] Base64 decode failed:", e);
      }
    } else if (contentTransferEncoding === "quoted-printable") {
      decodedBody = decodeQuotedPrintable(bodyStr);
    }
  }

  return {
    headers,
    body: decodedBody,
    contentType,
    parts,
  };
}

/**
 * Main entry point: Parses a raw email string into standard HTML/plain text fields
 */
export function parseRawEmail(raw: string): ParsedEmail {
  const rootPart = parsePart(raw);

  const headers = rootPart.headers;
  const from = decodeHeader(headers["from"] || "");
  const to = decodeHeader(headers["to"] || "");
  const subject = decodeHeader(headers["subject"] || "(No Subject)");

  let date = new Date();
  if (headers["date"]) {
    const parsedDate = new Date(headers["date"]);
    if (!isNaN(parsedDate.getTime())) {
      date = parsedDate;
    }
  }

  let text = "";
  let html = "";

  function extractBodies(part: MailPart) {
    const contentTypeClean = part.contentType.toLowerCase().split(";")[0].trim();
    if (contentTypeClean === "text/plain") {
      text += part.body;
    } else if (contentTypeClean === "text/html") {
      html += part.body;
    }

    for (const subPart of part.parts) {
      extractBodies(subPart);
    }
  }

  extractBodies(rootPart);

  // Fallback: If no bodies extracted, use root part
  if (!text && !html) {
    const rootContentType = rootPart.contentType.toLowerCase().split(";")[0].trim();
    if (rootContentType === "text/html") {
      html = rootPart.body;
    } else {
      text = rootPart.body;
    }
  }

  return {
    from,
    to,
    subject,
    date,
    text: text.trim(),
    html: html.trim(),
    headers: rootPart.headers,
  };
}
