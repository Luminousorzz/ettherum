import { db } from "../db";
import { tempMailAddresses, tempMailMessages } from "../db/schema";
import { eq } from "drizzle-orm";
import { parseRawEmail } from "../utils/mime";

let smtpServerInstance: any = null;

/**
 * Extracts all valid email addresses from a header string
 */
function extractEmails(str: string): string[] {
  if (!str) return [];
  const matches = str.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
  return matches ? matches.map(m => m.toLowerCase().trim()) : [];
}

/**
 * Shared utility to handle an incoming raw email message.
 * Parses the MIME contents and saves it in the database if the recipient address matches an active temp mail.
 */
export async function handleIncomingEmail(rawEmail: string): Promise<boolean> {
  try {
    const parsed = parseRawEmail(rawEmail);
    const recipients = extractEmails(parsed.to);
    
    // Also parse headers for Cc
    const ccHeaders = rootPartHeaders(rawEmail)["cc"] || "";
    recipients.push(...extractEmails(ccHeaders));
    
    // Deduplicate recipients
    const uniqueRecipients = [...new Set(recipients)];
    let matched = false;

    for (const recipient of uniqueRecipients) {
      const addrRow = await db.select().from(tempMailAddresses).where(eq(tempMailAddresses.address, recipient)).get();
      if (addrRow) {
        await db.insert(tempMailMessages).values({
          addressId: addrRow.id,
          sender: parsed.from,
          subject: parsed.subject,
          bodyText: parsed.text,
          bodyHtml: parsed.html,
          rawEmail: rawEmail,
          isRead: false,
        });
        matched = true;
        console.log(`[TempMail] Stored incoming email for: ${recipient} (From: ${parsed.from})`);
      }
    }
    
    return matched;
  } catch (e) {
    console.error("[TempMail] Error handling incoming email:", e);
    return false;
  }
}

/**
 * Helper to parse only the root level headers quickly (without full body processing)
 */
function rootPartHeaders(raw: string): Record<string, string> {
  const doubleNewlineIndex = raw.indexOf("\r\n\r\n") !== -1 ? raw.indexOf("\r\n\r\n") : raw.indexOf("\n\n");
  if (doubleNewlineIndex === -1) return {};
  
  const headersStr = raw.substring(0, doubleNewlineIndex);
  const unfoldedHeaders = headersStr.replace(/\r?\n[ \t]+/g, " ");
  const lines = unfoldedHeaders.split(/\r?\n/);
  const headers: Record<string, string> = {};
  
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      headers[line.substring(0, colonIdx).trim().toLowerCase()] = line.substring(colonIdx + 1).trim();
    }
  }
  return headers;
}

/**
 * Starts the built-in SMTP listener on the specified port.
 */
export function startSmtpServer(port: number) {
  if (smtpServerInstance) {
    console.log("[SMTP] SMTP Server already running. Restarting...");
    stopSmtpServer();
  }

  try {
    smtpServerInstance = Bun.listen({
      hostname: "0.0.0.0",
      port,
      socket: {
        open(socket) {
          // Initialize SMTP session state
          socket.data = {
            state: "COMMAND", // COMMAND or DATA
            from: "",
            to: [] as string[],
            rawData: "",
            buffer: "",
          };
          socket.write("220 Etteum SMTP Server Ready\r\n");
        },
        async data(socket, data) {
          socket.data.buffer += data.toString();

          while (true) {
            if (socket.data.state === "DATA") {
              // In DATA mode, look for the termination line: CRLF . CRLF
              const buffer = socket.data.buffer;
              
              // We search for \r\n.\r\n or \n.\r\n or \r\n.\n or \n.\n
              const termIdx = buffer.indexOf("\r\n.\r\n");
              const termLen = 5;
              let foundTermIdx = termIdx;
              let foundTermLen = termLen;

              if (foundTermIdx === -1) {
                // Check other newline combinations
                const termIdx2 = buffer.indexOf("\n.\n");
                if (termIdx2 !== -1) {
                  foundTermIdx = termIdx2;
                  foundTermLen = 3;
                } else {
                  const termIdx3 = buffer.indexOf("\r\n.\n");
                  if (termIdx3 !== -1) {
                    foundTermIdx = termIdx3;
                    foundTermLen = 4;
                  } else {
                    const termIdx4 = buffer.indexOf("\n.\r\n");
                    if (termIdx4 !== -1) {
                      foundTermIdx = termIdx4;
                      foundTermLen = 4;
                    }
                  }
                }
              }

              if (foundTermIdx !== -1) {
                // Extract everything up to the dot as email body
                const emailChunk = buffer.substring(0, foundTermIdx);
                socket.data.rawData += emailChunk;
                
                // Keep the remainder in buffer
                socket.data.buffer = buffer.substring(foundTermIdx + foundTermLen);
                
                // Process email in background
                const rawMail = socket.data.rawData;
                socket.data.rawData = "";
                socket.data.state = "COMMAND";
                
                const matched = await handleIncomingEmail(rawMail);
                if (matched) {
                  socket.write("250 OK Message accepted for delivery\r\n");
                } else {
                  socket.write("250 OK Message processed (recipient not in active temp list)\r\n");
                }
              } else {
                // No termination seen yet. Consume most of the buffer into rawData
                // but keep the last 5 characters in case the boundary was split across TCP packets.
                if (buffer.length > 5) {
                  const consumeLength = buffer.length - 5;
                  socket.data.rawData += buffer.substring(0, consumeLength);
                  socket.data.buffer = buffer.substring(consumeLength);
                }
                break; // Wait for more data
              }
            } else {
              // Command mode: Parse line by line
              const newlineIdx = socket.data.buffer.indexOf("\n");
              if (newlineIdx === -1) break;

              let line = socket.data.buffer.substring(0, newlineIdx);
              socket.data.buffer = socket.data.buffer.substring(newlineIdx + 1);

              if (line.endsWith("\r")) {
                line = line.substring(0, line.length - 1);
              }

              const trimmed = line.trim();
              if (trimmed === "") continue;

              const cmd = trimmed.substring(0, 4).toUpperCase();

              if (cmd === "HELO" || cmd === "EHLO") {
                socket.write(`250-Hello ${trimmed.substring(5) || "localhost"}\r\n250-SIZE 10485760\r\n250 HELP\r\n`);
              } else if (cmd === "MAIL") {
                const fromMatch = trimmed.match(/FROM:\s*<([^>]+)>/i);
                socket.data.from = fromMatch ? fromMatch[1] : "";
                socket.write("250 2.1.0 OK\r\n");
              } else if (cmd === "RCPT") {
                const toMatch = trimmed.match(/TO:\s*<([^>]+)>/i);
                if (toMatch) {
                  socket.data.to.push(toMatch[1]);
                  socket.write("250 2.1.5 OK\r\n");
                } else {
                  socket.write("501 5.5.4 Invalid address format\r\n");
                }
              } else if (cmd === "DATA") {
                socket.data.state = "DATA";
                socket.data.rawData = "";
                socket.write("354 Start mail input; end with <CRLF>.<CRLF>\r\n");
              } else if (cmd === "RSET") {
                socket.data.from = "";
                socket.data.to = [];
                socket.data.rawData = "";
                socket.data.state = "COMMAND";
                socket.write("250 2.0.0 OK\r\n");
              } else if (cmd === "QUIT") {
                socket.write("221 2.0.0 Bye\r\n");
                socket.close();
                break;
              } else if (cmd === "NOOP") {
                socket.write("250 2.0.0 OK\r\n");
              } else {
                socket.write("500 5.5.1 Command not recognized\r\n");
              }
            }
          }
        },
        error(socket, error) {
          console.error("[SMTP] Socket error:", error.message);
        },
      },
    });
    console.log(`[SMTP] Server started successfully on port ${port}`);
  } catch (err: any) {
    console.error(`[SMTP] Error starting server on port ${port}:`, err.message);
  }
}

/**
 * Stops the running SMTP listener.
 */
export function stopSmtpServer() {
  if (smtpServerInstance) {
    try {
      smtpServerInstance.close();
      console.log("[SMTP] Server stopped.");
    } catch (e: any) {
      console.error("[SMTP] Error closing SMTP server:", e.message);
    }
    smtpServerInstance = null;
  }
}
