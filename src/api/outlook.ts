import { Hono } from "hono";
import { db } from "../db/index";
import { accounts } from "../db/schema";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "../utils/crypto";
import { config, type ProviderName } from "../config";
import { pool } from "../proxy/pool";
import { broadcast } from "../ws/index";

export const outlookRouter = new Hono();

function callbackHtml(title: string, message: string, closeWindow = false) {
  const closeScript = closeWindow
    ? `<script>setTimeout(() => window.close(), 1200)</script>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title></head><body style="font-family:system-ui,sans-serif;padding:24px;background:#0b0f14;color:#e5e7eb"><div style="max-width:520px;margin:40px auto;padding:24px;border:1px solid #334155;border-radius:12px;background:#111827"><h1 style="margin:0 0 12px;font-size:20px">${title}</h1><p style="margin:0;color:#cbd5e1">${message}</p></div>${closeScript}</body></html>`;
}

/**
 * Helper: Refresh Microsoft OAuth Access Token if expired
 */
export async function getOutlookAccessToken(accountId: number): Promise<string> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account || account.provider !== "outlook") {
    throw new Error("Outlook account not found");
  }

  const tokens = typeof account.tokens === "string"
    ? JSON.parse(account.tokens)
    : account.tokens as any;

  if (!tokens || !tokens.refresh_token) {
    throw new Error("Account is not linked to Microsoft OAuth");
  }

  const now = Date.now();
  // Return cached token if valid (with 5-minute buffer)
  if (tokens.access_token && tokens.expires_at && tokens.expires_at > now + 5 * 60 * 1000) {
    return tokens.access_token;
  }

  // Refresh token
  const clientId = config.outlookClientId || process.env.OUTLOOK_CLIENT_ID || "";
  const clientSecret = config.outlookClientSecret || process.env.OUTLOOK_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) {
    throw new Error("OUTLOOK_CLIENT_ID or OUTLOOK_CLIENT_SECRET is not configured in .env");
  }

  const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Failed to refresh Microsoft token: ${errText}`);
  }

  const data = await response.json() as any;
  const newTokens = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000),
  };

  await db.update(accounts).set({
    tokens: newTokens,
    updatedAt: new Date(),
  }).where(eq(accounts.id, accountId));

  return data.access_token;
}

/**
 * GET /api/accounts/outlook/authorize - Generate Microsoft Auth URL and redirect
 */
outlookRouter.get("/authorize", async (c) => {
  const accountId = c.req.query("id");
  if (!accountId) {
    return c.text("Missing account 'id' query parameter", 400);
  }

  const clientId = config.outlookClientId || process.env.OUTLOOK_CLIENT_ID || "";
  if (!clientId) {
    return c.text("OUTLOOK_CLIENT_ID is not configured on the server", 500);
  }

  // Dynamically build redirect URI pointing to this server
  const protocol = new URL(c.req.url).protocol;
  const host = new URL(c.req.url).host;
  const redirectUri = `${protocol}//${host}/api/accounts/outlook/callback`;

  const scopes = "offline_access https://graph.microsoft.com/Mail.Read";
  const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=accountId:${accountId}&prompt=consent`;

  return c.redirect(authUrl);
});

/**
 * GET /api/accounts/outlook/callback - Handle OAuth2 redirect callback from Microsoft
 */
outlookRouter.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  const errorDesc = c.req.query("error_description") || error;

  if (error) {
    return c.html(callbackHtml("Connection Failed", `Microsoft error: ${errorDesc}`), 400);
  }

  if (!code || !state || !state.startsWith("accountId:")) {
    return c.html(callbackHtml("Connection Failed", "Invalid authorization code or state parameter."), 400);
  }

  const accountId = Number(state.replace("accountId:", ""));
  if (isNaN(accountId)) {
    return c.html(callbackHtml("Connection Failed", "Invalid Account ID in state."), 400);
  }

  const clientId = config.outlookClientId || process.env.OUTLOOK_CLIENT_ID || "";
  const clientSecret = config.outlookClientSecret || process.env.OUTLOOK_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) {
    return c.html(callbackHtml("Connection Failed", "Microsoft OAuth client details are not configured in server .env."), 500);
  }

  const protocol = new URL(c.req.url).protocol;
  const host = new URL(c.req.url).host;
  const redirectUri = `${protocol}//${host}/api/accounts/outlook/callback`;

  try {
    const response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Token exchange failed: ${errText}`);
    }

    const data = await response.json() as any;
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000),
    };

    // Update account with status active and save tokens
    await db.update(accounts).set({
      status: "active",
      tokens: tokens,
      errorMessage: null,
      updatedAt: new Date(),
    }).where(eq(accounts.id, accountId));

    pool.invalidate("outlook" as ProviderName);
    broadcast({ type: "account_status", data: { id: accountId, status: "active" } });

    return c.html(callbackHtml("Success!", "Outlook account successfully linked! You can close this window now.", true));
  } catch (err: any) {
    return c.html(callbackHtml("Connection Failed", `Failed to exchange token: ${err.message}`), 500);
  }
});

/**
 * GET /api/accounts/outlook/:id/messages - Fetch inbox messages from Microsoft Graph API
 */
outlookRouter.get("/:id/messages", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid Account ID" }, 400);

  try {
    const accessToken = await getOutlookAccessToken(id);
    // Fetch latest 30 emails
    const response = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=30&$select=id,subject,from,receivedDateTime,bodyPreview,isRead&$orderby=receivedDateTime desc", {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Graph API error: ${errText}`);
    }

    const data = await response.json() as any;
    const messages = (data.value || []).map((msg: any) => ({
      id: msg.id,
      subject: msg.subject || "(No Subject)",
      sender: msg.from?.emailAddress?.address || "unknown@microsoft.com",
      senderName: msg.from?.emailAddress?.name || "",
      bodyPreview: msg.bodyPreview || "",
      isRead: msg.isRead || false,
      createdAt: msg.receivedDateTime || new Date().toISOString(),
    }));

    return c.json(messages);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to fetch emails" }, 500);
  }
});

/**
 * GET /api/accounts/outlook/:id/messages/:msgId - Fetch full details of an email message
 */
outlookRouter.get("/:id/messages/:msgId", async (c) => {
  const id = Number(c.req.param("id"));
  const msgId = c.req.param("msgId");

  if (isNaN(id) || !msgId) return c.json({ error: "Invalid parameters" }, 400);

  try {
    const accessToken = await getOutlookAccessToken(id);
    const response = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${msgId}?$select=id,subject,from,receivedDateTime,body,isRead`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Graph API error: ${errText}`);
    }

    const msg = await response.json() as any;
    return c.json({
      id: msg.id,
      subject: msg.subject || "(No Subject)",
      sender: msg.from?.emailAddress?.address || "unknown@microsoft.com",
      senderName: msg.from?.emailAddress?.name || "",
      bodyText: msg.body?.contentType === "text" ? msg.body.content : "",
      bodyHtml: msg.body?.contentType === "html" ? msg.body.content : "",
      isRead: msg.isRead || false,
      createdAt: msg.receivedDateTime || new Date().toISOString(),
    });
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to fetch email detail" }, 500);
  }
});

/**
 * GET /api/accounts/outlook/:id/otp - Poll inbox for OTP/Verification Code
 */
outlookRouter.get("/:id/otp", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid Account ID" }, 400);

  const senderFilter = c.req.query("sender")?.toLowerCase() || "";
  const timeoutMs = Number(c.req.query("timeout") || 60000); // 60s timeout default
  const startMs = Date.now();

  try {
    const accessToken = await getOutlookAccessToken(id);

    // Poll loop
    while (Date.now() - startMs < timeoutMs) {
      // Fetch latest 5 emails from Graph API
      const response = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=5&$select=id,subject,from,receivedDateTime,bodyPreview,body&$orderby=receivedDateTime desc", {
        headers: { "Authorization": `Bearer ${accessToken}` },
      });

      if (response.ok) {
        const data = await response.json() as any;
        const messages = data.value || [];

        for (const msg of messages) {
          const sender = (msg.from?.emailAddress?.address || "").toLowerCase();
          
          // Check sender filter if provided
          if (senderFilter && !sender.includes(senderFilter)) {
            continue;
          }

          // Check if email was received recently (within the last 5 minutes)
          const receivedAt = new Date(msg.receivedDateTime).getTime();
          if (Date.now() - receivedAt < 5 * 60 * 1000) {
            const bodyContent = msg.body?.content || msg.bodyPreview || "";
            
            // Regex to find 4, 5, or 6-digit codes (e.g. 123456)
            // Matches boundaries to avoid matching years (like 2026) or long IDs
            const match = bodyContent.match(/\b(?!19\d{2}\b|20\d{2}\b)(\d{4,6})\b/);
            if (match) {
              const otp = match[1];
              return c.json({
                success: true,
                otp,
                subject: msg.subject,
                sender,
                receivedAt: msg.receivedDateTime,
              });
            }
          }
        }
      }

      // Wait 3 seconds before polling again
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return c.json({ error: "OTP verification email not found within timeout limit" }, 404);
  } catch (err: any) {
    return c.json({ error: err.message || "Failed to retrieve OTP" }, 500);
  }
});
