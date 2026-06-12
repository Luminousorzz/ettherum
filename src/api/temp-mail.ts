import { Hono } from "hono";
import { db } from "../db";
import { tempMailDomains, tempMailAddresses, tempMailMessages, settings } from "../db/schema";
import { eq, desc, and } from "drizzle-orm";
import { handleIncomingEmail, startSmtpServer, stopSmtpServer } from "../services/smtp";
import crypto from "crypto";

export const tempMailRouter = new Hono();

function generateRandomPrefix(length = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function extractEmails(str: string): string[] {
  if (!str) return [];
  const matches = str.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
  return matches ? matches.map(m => m.toLowerCase().trim()) : [];
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAINS
// ─────────────────────────────────────────────────────────────────────────────

// Get all configured domains
tempMailRouter.get("/domains", async (c) => {
  const allDomains = await db.select().from(tempMailDomains).orderBy(desc(tempMailDomains.createdAt));
  return c.json(allDomains);
});

// Add a new custom domain
tempMailRouter.post("/domains", async (c) => {
  const body = await c.req.json();
  const domainName = body.domain?.toLowerCase().trim();
  
  if (!domainName) {
    return c.json({ error: "Domain name is required" }, 400);
  }

  // Validate basic domain structure
  if (!/^[a-z0-9]+([-.]{1}[a-z0-9]+)*\.[a-z]{2,5}$/i.test(domainName)) {
    return c.json({ error: "Invalid domain name format" }, 400);
  }

  try {
    const [inserted] = await db.insert(tempMailDomains).values({
      domain: domainName,
    }).returning();
    return c.json(inserted);
  } catch (err: any) {
    if (err.message?.toLowerCase().includes("unique")) {
      return c.json({ error: "Domain is already configured" }, 409);
    }
    return c.json({ error: "Failed to create domain" }, 500);
  }
});

// Delete a custom domain
tempMailRouter.delete("/domains/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) {
    return c.json({ error: "Invalid domain ID" }, 400);
  }

  const deleted = await db.delete(tempMailDomains).where(eq(tempMailDomains.id, id)).returning();
  if (deleted.length === 0) {
    return c.json({ error: "Domain not found" }, 404);
  }
  return c.json({ success: true, deleted: deleted[0] });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESSES
// ─────────────────────────────────────────────────────────────────────────────

// Get all generated email addresses
tempMailRouter.get("/addresses", async (c) => {
  const allAddresses = await db.select().from(tempMailAddresses).orderBy(desc(tempMailAddresses.createdAt));
  return c.json(allAddresses);
});

// Generate a new temporary address
tempMailRouter.post("/addresses", async (c) => {
  const body = await c.req.json();
  const domainId = parseInt(body.domainId);
  const prefix = body.prefix?.toLowerCase().trim() || generateRandomPrefix(8);
  const expiryHours = parseInt(body.expiryHours); // Optional expiry time

  if (isNaN(domainId)) {
    return c.json({ error: "Invalid domainId" }, 400);
  }

  // Confirm domain exists
  const domainRow = await db.select().from(tempMailDomains).where(eq(tempMailDomains.id, domainId)).get();
  if (!domainRow) {
    return c.json({ error: "Domain not found" }, 404);
  }

  // Validate custom prefix if provided
  if (body.prefix && !/^[a-z0-9._+-]+$/i.test(prefix)) {
    return c.json({ error: "Prefix contains invalid characters" }, 400);
  }

  const emailAddress = `${prefix}@${domainRow.domain}`;
  const expiresAt = !isNaN(expiryHours) && expiryHours > 0 
    ? new Date(Date.now() + expiryHours * 60 * 60 * 1000) 
    : null;

  try {
    const [inserted] = await db.insert(tempMailAddresses).values({
      domainId,
      address: emailAddress,
      expiresAt,
    }).returning();
    return c.json(inserted);
  } catch (err: any) {
    if (err.message?.toLowerCase().includes("unique")) {
      return c.json({ error: "Email address already exists" }, 409);
    }
    return c.json({ error: "Failed to generate address" }, 500);
  }
});

// Delete a temporary address
tempMailRouter.delete("/addresses/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) {
    return c.json({ error: "Invalid address ID" }, 400);
  }

  const deleted = await db.delete(tempMailAddresses).where(eq(tempMailAddresses.id, id)).returning();
  if (deleted.length === 0) {
    return c.json({ error: "Address not found" }, 404);
  }
  return c.json({ success: true, deleted: deleted[0] });
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────────────────────────────────────

// Get all messages for a specific address
tempMailRouter.get("/messages/:addressId", async (c) => {
  const addressId = parseInt(c.req.param("addressId"));
  if (isNaN(addressId)) {
    return c.json({ error: "Invalid address ID" }, 400);
  }

  // Mark all fetched messages as read
  await db.update(tempMailMessages)
    .set({ isRead: true })
    .where(and(eq(tempMailMessages.addressId, addressId), eq(tempMailMessages.isRead, false)));

  const messages = await db.select()
    .from(tempMailMessages)
    .where(eq(tempMailMessages.addressId, addressId))
    .orderBy(desc(tempMailMessages.createdAt));

  return c.json(messages);
});

// Delete a single message by ID
tempMailRouter.delete("/messages/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  if (isNaN(id)) {
    return c.json({ error: "Invalid message ID" }, 400);
  }

  const deleted = await db.delete(tempMailMessages).where(eq(tempMailMessages.id, id)).returning();
  if (deleted.length === 0) {
    return c.json({ error: "Message not found" }, 404);
  }
  return c.json({ success: true, deleted: deleted[0] });
});

// Clear all messages for a specific address
tempMailRouter.delete("/messages/clear/:addressId", async (c) => {
  const addressId = parseInt(c.req.param("addressId"));
  if (isNaN(addressId)) {
    return c.json({ error: "Invalid address ID" }, 400);
  }

  await db.delete(tempMailMessages).where(eq(tempMailMessages.addressId, addressId));
  return c.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

// Get Temp Mail configuration settings
tempMailRouter.get("/settings", async (c) => {
  const smtpEnabled = (await db.select().from(settings).where(eq(settings.key, "temp_mail_smtp_enabled")).get())?.value || "false";
  const smtpPort = (await db.select().from(settings).where(eq(settings.key, "temp_mail_smtp_port")).get())?.value || "2525";
  let webhookSecret = (await db.select().from(settings).where(eq(settings.key, "temp_mail_webhook_secret")).get())?.value || "";

  // Auto-generate a webhook secret if none exists
  if (!webhookSecret) {
    webhookSecret = crypto.randomBytes(24).toString("hex");
    await db.insert(settings).values({
      key: "temp_mail_webhook_secret",
      value: webhookSecret,
    }).onConflictDoUpdate({
      target: settings.key,
      set: { value: webhookSecret, updatedAt: new Date() },
    });
  }

  return c.json({
    smtpEnabled: smtpEnabled === "true",
    smtpPort: parseInt(smtpPort),
    webhookSecret,
  });
});

// Save Temp Mail settings and restart/stop the SMTP server accordingly
tempMailRouter.put("/settings", async (c) => {
  const body = await c.req.json();
  const smtpEnabled = body.smtpEnabled === true;
  const smtpPort = parseInt(body.smtpPort) || 2525;
  const webhookSecret = body.webhookSecret?.trim() || crypto.randomBytes(24).toString("hex");

  // Save to db
  await db.insert(settings).values({ key: "temp_mail_smtp_enabled", value: String(smtpEnabled) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(smtpEnabled), updatedAt: new Date() } });
    
  await db.insert(settings).values({ key: "temp_mail_smtp_port", value: String(smtpPort) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(smtpPort), updatedAt: new Date() } });

  await db.insert(settings).values({ key: "temp_mail_webhook_secret", value: webhookSecret })
    .onConflictDoUpdate({ target: settings.key, set: { value: webhookSecret, updatedAt: new Date() } });

  // Update SMTP state
  if (smtpEnabled) {
    console.log(`[SMTP] Enabling SMTP Server on port ${smtpPort}...`);
    startSmtpServer(smtpPort);
  } else {
    console.log("[SMTP] Disabling SMTP Server...");
    stopSmtpServer();
  }

  return c.json({
    success: true,
    settings: {
      smtpEnabled,
      smtpPort,
      webhookSecret,
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC WEBHOOK (BYPASSES AUTH MIDDLEWARE)
// ─────────────────────────────────────────────────────────────────────────────
tempMailRouter.post("/incoming", async (c) => {
  const secret = c.req.query("secret");
  const configuredSecretRow = await db.select().from(settings).where(eq(settings.key, "temp_mail_webhook_secret")).get();
  const configuredSecret = configuredSecretRow?.value || "";

  if (!configuredSecret || secret !== configuredSecret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const contentType = c.req.header("Content-Type") || "";
  let raw = "";

  if (contentType.includes("multipart/form-data") || contentType.includes("application/json")) {
    let body: any;
    try {
      if (contentType.includes("application/json")) {
        body = await c.req.json();
      } else {
        body = await c.req.parseBody();
      }
    } catch {
      body = {};
    }

    if (body.raw) {
      raw = body.raw;
    } else if (body.from && body.to) {
      // Parse direct fields instead of raw MIME
      const recipients = extractEmails(body.to);
      if (body.cc) recipients.push(...extractEmails(body.cc));
      const uniqueRecipients = [...new Set(recipients)];
      
      let matched = false;
      for (const recipient of uniqueRecipients) {
        const addrRow = await db.select().from(tempMailAddresses).where(eq(tempMailAddresses.address, recipient)).get();
        if (addrRow) {
          await db.insert(tempMailMessages).values({
            addressId: addrRow.id,
            sender: body.from,
            subject: body.subject || "(No Subject)",
            bodyText: body.text || "",
            bodyHtml: body.html || "",
            rawEmail: `Pre-parsed Webhook POST\r\nFrom: ${body.from}\r\nTo: ${body.to}\r\nSubject: ${body.subject}\r\n\r\n${body.text || ""}`,
            isRead: false,
          });
          matched = true;
          console.log(`[TempMail Webhook] Saved pre-parsed email for: ${recipient}`);
        }
      }
      return c.json({ success: true, matched });
    }
  } else {
    raw = await c.req.text();
  }

  if (!raw) {
    return c.json({ error: "Empty request body" }, 400);
  }

  const matched = await handleIncomingEmail(raw);
  return c.json({ success: true, matched });
});
