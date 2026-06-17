import { Hono } from "hono";
import { exec, execSync } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { db } from "../db/index";
import { settings, cloudflareTunnels, tunnelIngressRules } from "../db/schema";
import { eq, and } from "drizzle-orm";

export const tunnelsRouter = new Hono();

// Installer state
let isInstalling = false;
let installError: string | null = null;
let mockInstalled = false; // Dev mock install state

// Helper: Run command safely
function runCmd(cmd: string): string {
  try {
    return execSync(cmd, { stdio: "pipe", timeout: 3000 }).toString().trim();
  } catch (err: any) {
    return "";
  }
}

// Helper: Get Cloudflare API Settings
export async function getCloudflareSettings() {
  const allSettings = await db.select().from(settings);
  const settingsMap: Record<string, string | null> = {};
  for (const s of allSettings) {
    settingsMap[s.key] = s.value;
  }
  return {
    apiToken: settingsMap["cloudflare_api_token"] || "",
    accountId: settingsMap["cloudflare_account_id"] || "",
  };
}

// Helper: Find Zone ID for Hostname
export async function getZoneIdForHostname(apiToken: string, hostname: string): Promise<string> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones?per_page=50`, {
    headers: { Authorization: `Bearer ${apiToken}` }
  });
  const json = await res.json() as any;
  if (!json.success) {
    throw new Error(json.errors?.[0]?.message || "Failed to fetch DNS zones from Cloudflare");
  }
  const zones = json.result || [];
  // Find zone that matches suffix
  const matchingZones = zones.filter((z: any) => hostname === z.name || hostname.endsWith(`.${z.name}`));
  matchingZones.sort((a: any, b: any) => b.name.length - a.name.length);
  if (matchingZones.length === 0) {
    throw new Error(`No matching Cloudflare DNS Zone found for hostname ${hostname}`);
  }
  return matchingZones[0].id;
}

// Helper: Write Credentials and YAML files
export async function writeTunnelConfigs(tunnelId: string, accountId: string, secret: string, rules: any[]) {
  const isLinux = process.platform === "linux";
  const configDir = isLinux ? "/etc/cloudflared" : path.join(process.cwd(), "data", "cloudflared");
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // 1. Write credentials file
  const credsFile = path.join(configDir, `${tunnelId}.json`);
  const credsContent = JSON.stringify({
    AccountTag: accountId,
    TunnelSecret: secret,
    TunnelID: tunnelId
  }, null, 2);
  fs.writeFileSync(credsFile, credsContent, "utf8");

  // 2. Write YAML config file
  const yamlFile = path.join(configDir, `${tunnelId}.yml`);
  let yamlContent = `tunnel: ${tunnelId}\n`;
  yamlContent += `credentials-file: ${credsFile}\n\n`;
  yamlContent += `ingress:\n`;
  
  for (const r of rules) {
    yamlContent += `  - hostname: ${r.hostname}\n`;
    yamlContent += `    service: ${r.service}\n`;
  }
  yamlContent += `  - service: http_status:404\n`;

  fs.writeFileSync(yamlFile, yamlContent, "utf8");
}

// Helper: Create/Write systemd Service File
function writeSystemServiceFile(tunnelId: string) {
  if (process.platform !== "linux") return;
  
  const serviceFile = `/etc/systemd/system/cloudflared-${tunnelId}.service`;
  const serviceContent = `[Unit]
Description=Cloudflare Tunnel ${tunnelId}
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel --config /etc/cloudflared/${tunnelId}.yml run ${tunnelId}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
  
  fs.writeFileSync(serviceFile, serviceContent, "utf8");
  
  try {
    execSync("systemctl daemon-reload", { stdio: "pipe" });
  } catch (err: any) {
    console.error("Failed to run systemctl daemon-reload:", err.message);
  }
}

// Helper: Delete credentials, YAML and systemd service
async function deleteTunnelConfigsAndService(tunnelId: string) {
  const isLinux = process.platform === "linux";
  if (isLinux) {
    try {
      execSync(`systemctl stop cloudflared-${tunnelId}`, { stdio: "pipe" });
      execSync(`systemctl disable cloudflared-${tunnelId}`, { stdio: "pipe" });
    } catch {}
    
    const serviceFile = `/etc/systemd/system/cloudflared-${tunnelId}.service`;
    if (fs.existsSync(serviceFile)) {
      try { fs.unlinkSync(serviceFile); } catch {}
    }
    
    try {
      execSync("systemctl daemon-reload", { stdio: "pipe" });
    } catch {}

    const configDir = "/etc/cloudflared";
    const credsFile = path.join(configDir, `${tunnelId}.json`);
    const yamlFile = path.join(configDir, `${tunnelId}.yml`);
    if (fs.existsSync(credsFile)) {
      try { fs.unlinkSync(credsFile); } catch {}
    }
    if (fs.existsSync(yamlFile)) {
      try { fs.unlinkSync(yamlFile); } catch {}
    }
  } else {
    const configDir = path.join(process.cwd(), "data", "cloudflared");
    const credsFile = path.join(configDir, `${tunnelId}.json`);
    const yamlFile = path.join(configDir, `${tunnelId}.yml`);
    if (fs.existsSync(credsFile)) {
      try { fs.unlinkSync(credsFile); } catch {}
    }
    if (fs.existsSync(yamlFile)) {
      try { fs.unlinkSync(yamlFile); } catch {}
    }
  }
}

// Helper: Sync existing CNAME DNS records from Cloudflare for an imported tunnel
async function syncIngressRulesFromDns(apiToken: string, tunnelId: string) {
  try {
    const zonesRes = await fetch(`https://api.cloudflare.com/client/v4/zones?per_page=50`, {
      headers: { Authorization: `Bearer ${apiToken}` }
    });
    const zonesJson = await zonesRes.json() as any;
    if (!zonesJson.success) return;
    const zones = zonesJson.result || [];

    for (const z of zones) {
      const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${z.id}/dns_records?type=CNAME&content=${tunnelId}.cfargotunnel.com`, {
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      const dnsJson = await dnsRes.json() as any;
      if (!dnsJson.success) continue;
      const records = dnsJson.result || [];

      for (const r of records) {
        const [existingRule] = await db
          .select()
          .from(tunnelIngressRules)
          .where(and(eq(tunnelIngressRules.tunnelId, tunnelId), eq(tunnelIngressRules.hostname, r.name)));

        if (!existingRule) {
          // Insert local rule with safe default mapping (Etteum dashboard port 1931)
          await db.insert(tunnelIngressRules).values({
            tunnelId,
            hostname: r.name,
            service: "http://localhost:1931",
            dnsRecordId: r.id
          });

          // Re-generate configuration files to include this imported rule
          const [tunnel] = await db.select().from(cloudflareTunnels).where(eq(cloudflareTunnels.id, tunnelId));
          if (tunnel) {
            const creds = JSON.parse(tunnel.credentials);
            const allRules = await db.select().from(tunnelIngressRules).where(eq(tunnelIngressRules.tunnelId, tunnelId));
            await writeTunnelConfigs(tunnelId, creds.AccountTag, creds.TunnelSecret, allRules);
          }
        } else if (!existingRule.dnsRecordId) {
          await db
            .update(tunnelIngressRules)
            .set({ dnsRecordId: r.id })
            .where(eq(tunnelIngressRules.id, existingRule.id));
        }
      }
    }
  } catch (err: any) {
    console.error(`Failed to sync DNS records for tunnel ${tunnelId}:`, err.message);
  }
}

// Helper: Sync all tunnels with Cloudflare account
async function syncTunnelsWithCloudflare(apiToken: string, accountId: string) {
  if (!apiToken || !accountId || apiToken === "mock_token") return;

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel?is_deleted=false`, {
      headers: { Authorization: `Bearer ${apiToken}` }
    });
    const json = await res.json() as any;
    if (!json.success) {
      console.error("Failed to fetch tunnels from Cloudflare during sync:", json.errors?.[0]?.message);
      return;
    }

    const cfTunnels = json.result || [];
    const cfTunnelIds = new Set(cfTunnels.map((t: any) => t.id));

    // 1. Delete local tunnels that no longer exist on Cloudflare
    const localTunnels = await db.select().from(cloudflareTunnels);
    for (const lt of localTunnels) {
      if (!cfTunnelIds.has(lt.id)) {
        await deleteTunnelConfigsAndService(lt.id);
        await db.delete(cloudflareTunnels).where(eq(cloudflareTunnels.id, lt.id));
      }
    }

    // 2. Import or update tunnels from Cloudflare
    for (const cfT of cfTunnels) {
      const existingLocal = localTunnels.find((lt) => lt.id === cfT.id);
      if (!existingLocal) {
        try {
          // Fetch token from Cloudflare API
          const tokenRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${cfT.id}/token`, {
            headers: { Authorization: `Bearer ${apiToken}` }
          });
          const tokenJson = await tokenRes.json() as any;
          if (tokenJson.success && tokenJson.result) {
            const tokenBase64 = tokenJson.result;
            const decoded = Buffer.from(tokenBase64, "base64").toString("utf8");
            const tokenObj = JSON.parse(decoded);
            const secret = tokenObj.s;

            const credsJson = JSON.stringify({
              AccountTag: accountId,
              TunnelSecret: secret,
              TunnelID: cfT.id,
            });

            // Insert into local DB
            await db.insert(cloudflareTunnels).values({
              id: cfT.id,
              name: cfT.name,
              credentials: credsJson,
              status: "inactive",
            });

            // Write local credentials and configuration files
            await writeTunnelConfigs(cfT.id, accountId, secret, []);
            writeSystemServiceFile(cfT.id);

            // Sync CNAME DNS records for this imported tunnel
            await syncIngressRulesFromDns(apiToken, cfT.id);
          }
        } catch (err: any) {
          console.error(`Failed to import tunnel ${cfT.name} token:`, err.message);
        }
      } else {
        if (existingLocal.name !== cfT.name) {
          await db.update(cloudflareTunnels).set({ name: cfT.name }).where(eq(cloudflareTunnels.id, cfT.id));
        }
        // Sync rules for existing tunnel
        await syncIngressRulesFromDns(apiToken, cfT.id);
      }
    }
  } catch (err: any) {
    console.error("Error in syncTunnelsWithCloudflare:", err.message);
  }
}

/**
 * GET /api/tunnels/status
 * Check if cloudflared binary is installed and installation progress
 */
tunnelsRouter.get("/status", async (c) => {
  const isLinux = process.platform === "linux";
  let installed = false;
  if (isLinux) {
    try {
      execSync("which cloudflared", { stdio: "pipe" });
      installed = true;
    } catch {}
  } else {
    installed = mockInstalled;
  }

  return c.json({
    installed,
    isInstalling,
    installError,
    platform: process.platform,
  });
});

/**
 * POST /api/tunnels/install
 * Installs cloudflared daemon on Linux
 */
tunnelsRouter.post("/install", async (c) => {
  const isLinux = process.platform === "linux";
  
  if (isInstalling) {
    return c.json({ error: "Installation is already in progress" }, 400);
  }

  isInstalling = true;
  installError = null;

  if (isLinux) {
    const cmd = `sudo mkdir -p --mode=0755 /usr/share/keyrings && curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared debian-stable main" | sudo tee /etc/apt/sources.list.d/cloudflared.list && sudo apt-get update && sudo apt-get install -y cloudflared`;
    
    exec(cmd, (error, stdout, stderr) => {
      isInstalling = false;
      if (error) {
        installError = `Failed to install cloudflared: ${error.message}. Output: ${stderr}`;
        console.error(installError);
      }
    });
  } else {
    // Windows Mock installation delay
    setTimeout(() => {
      isInstalling = false;
      mockInstalled = true;
    }, 3000);
  }

  return c.json({ success: true, message: "Installation started in background" });
});

/**
 * GET /api/tunnels
 * List all tunnels and their status
 */
tunnelsRouter.get("/", async (c) => {
  const isLinux = process.platform === "linux";
  const { apiToken, accountId } = await getCloudflareSettings();
  
  if (apiToken && accountId && apiToken !== "mock_token") {
    await syncTunnelsWithCloudflare(apiToken, accountId);
  }

  const list = await db.select().from(cloudflareTunnels);
  const data = [];

  for (const t of list) {
    let status = t.status;
    if (isLinux) {
      try {
        const out = runCmd(`systemctl is-active cloudflared-${t.id}`);
        status = out === "active" ? "active" : "inactive";
      } catch {
        status = "inactive";
      }
    }
    data.push({
      id: t.id,
      name: t.name,
      status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    });
  }

  return c.json({ data });
});

/**
 * POST /api/tunnels
 * Create a new cloudflared tunnel
 */
tunnelsRouter.post("/", async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  if (!name || name.trim() === "") {
    return c.json({ error: "Tunnel name is required" }, 400);
  }

  const { apiToken, accountId } = await getCloudflareSettings();
  if (!apiToken || !accountId) {
    return c.json({ error: "Cloudflare API Token and Account ID are not configured in Settings" }, 400);
  }

  const secret = crypto.randomBytes(32).toString("base64");
  const isLinux = process.platform === "linux";

  try {
    let tunnelId = "";
    if (isLinux || apiToken !== "mock_token") {
      // Create tunnel via Cloudflare API
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          tunnel_secret: secret,
        }),
      });

      const json = await res.json() as any;
      if (!json.success) {
        return c.json({ error: json.errors?.[0]?.message || "Failed to create tunnel on Cloudflare" }, 500);
      }
      tunnelId = json.result.id;
    } else {
      // Mock tunnel creation on Windows
      tunnelId = crypto.randomUUID();
    }

    // Insert tunnel into local SQLite database
    const credsJson = JSON.stringify({
      AccountTag: accountId,
      TunnelSecret: secret,
      TunnelID: tunnelId,
    });

    await db.insert(cloudflareTunnels).values({
      id: tunnelId,
      name: name.trim(),
      credentials: credsJson,
      status: "inactive",
    });

    // Write default configs and systemd unit file
    await writeTunnelConfigs(tunnelId, accountId, secret, []);
    writeSystemServiceFile(tunnelId);

    return c.json({ success: true, id: tunnelId });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * DELETE /api/tunnels/:id
 * Delete a tunnel from local DB, cleanup files, delete from Cloudflare API
 */
tunnelsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const { apiToken, accountId } = await getCloudflareSettings();

  // Find tunnel
  const [tunnel] = await db.select().from(cloudflareTunnels).where(eq(cloudflareTunnels.id, id));
  if (!tunnel) {
    return c.json({ error: "Tunnel not found" }, 404);
  }

  try {
    // Delete from Cloudflare API if config is present
    if (apiToken && accountId && apiToken !== "mock_token") {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      });
      // We log but continue deletion locally even if cloudflare API fails (e.g. tunnel already deleted there)
      const json = await res.json() as any;
      if (!json.success) {
        console.warn("Cloudflare API tunnel deletion warning:", json.errors?.[0]?.message);
      }
    }

    // Clean up files and systemd service
    await deleteTunnelConfigsAndService(id);

    // Delete from SQLite database (cascade deletes ingress rules)
    await db.delete(cloudflareTunnels).where(eq(cloudflareTunnels.id, id));

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * GET /api/tunnels/:id/rules
 * List all ingress rules for a tunnel
 */
tunnelsRouter.get("/:id/rules", async (c) => {
  const id = c.req.param("id");
  const rules = await db.select().from(tunnelIngressRules).where(eq(tunnelIngressRules.tunnelId, id));
  return c.json({ data: rules });
});

/**
 * POST /api/tunnels/:id/rules
 * Add an ingress rule, update config YAML, add DNS CNAME automatically
 */
tunnelsRouter.post("/:id/rules", async (c) => {
  const tunnelId = c.req.param("id");
  const { hostname, service } = await c.req.json<{ hostname: string; service: string }>();

  if (!hostname || !service) {
    return c.json({ error: "Hostname and local service address are required" }, 400);
  }

  const [tunnel] = await db.select().from(cloudflareTunnels).where(eq(cloudflareTunnels.id, tunnelId));
  if (!tunnel) {
    return c.json({ error: "Tunnel not found" }, 404);
  }

  const { apiToken } = await getCloudflareSettings();
  let dnsRecordId = "";

  try {
    // 1. Sync CNAME Record on Cloudflare
    if (apiToken && apiToken !== "mock_token") {
      try {
        const zoneId = await getZoneIdForHostname(apiToken, hostname.trim());
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "CNAME",
            name: hostname.trim(),
            content: `${tunnelId}.cfargotunnel.com`,
            ttl: 1,
            proxied: true,
          }),
        });
        const json = await res.json() as any;
        if (!json.success) {
          throw new Error(json.errors?.[0]?.message || "Failed to create DNS record");
        }
        dnsRecordId = json.result.id;
      } catch (dnsErr: any) {
        console.error("DNS Sync error:", dnsErr.message);
        return c.json({ error: `Failed to sync CNAME to Cloudflare DNS: ${dnsErr.message}` }, 500);
      }
    } else {
      dnsRecordId = `mock_dns_${crypto.randomUUID()}`;
    }

    // 2. Insert Ingress Rule into DB
    await db.insert(tunnelIngressRules).values({
      tunnelId,
      hostname: hostname.trim(),
      service: service.trim(),
      dnsRecordId: dnsRecordId || null,
    });

    // 3. Re-generate configuration files
    const allRules = await db.select().from(tunnelIngressRules).where(eq(tunnelIngressRules.tunnelId, tunnelId));
    const creds = JSON.parse(tunnel.credentials);
    await writeTunnelConfigs(tunnelId, creds.AccountTag, creds.TunnelSecret, allRules);

    // 4. Hot-reload/Restart tunnel if service is active
    const isLinux = process.platform === "linux";
    if (isLinux) {
      const isActive = runCmd(`systemctl is-active cloudflared-${tunnelId}`) === "active";
      if (isActive) {
        execSync(`systemctl restart cloudflared-${tunnelId}`, { stdio: "pipe" });
      }
    }

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * DELETE /api/tunnels/:id/rules/:ruleId
 * Delete an ingress rule, update config YAML, delete DNS CNAME automatically
 */
tunnelsRouter.delete("/:id/rules/:ruleId", async (c) => {
  const tunnelId = c.req.param("id");
  const ruleId = parseInt(c.req.param("ruleId"));

  const [tunnel] = await db.select().from(cloudflareTunnels).where(eq(cloudflareTunnels.id, tunnelId));
  if (!tunnel) {
    return c.json({ error: "Tunnel not found" }, 404);
  }

  const [rule] = await db
    .select()
    .from(tunnelIngressRules)
    .where(and(eq(tunnelIngressRules.id, ruleId), eq(tunnelIngressRules.tunnelId, tunnelId)));

  if (!rule) {
    return c.json({ error: "Ingress rule not found" }, 404);
  }

  const { apiToken } = await getCloudflareSettings();

  try {
    // 1. Delete DNS Record on Cloudflare
    if (apiToken && apiToken !== "mock_token" && rule.dnsRecordId && !rule.dnsRecordId.startsWith("mock_")) {
      try {
        const zoneId = await getZoneIdForHostname(apiToken, rule.hostname);
        await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${rule.dnsRecordId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        });
      } catch (dnsErr: any) {
        console.warn("DNS Cleanup error:", dnsErr.message);
      }
    }

    // 2. Delete from SQLite DB
    await db.delete(tunnelIngressRules).where(eq(tunnelIngressRules.id, ruleId));

    // 3. Re-generate configuration files
    const allRules = await db.select().from(tunnelIngressRules).where(eq(tunnelIngressRules.tunnelId, tunnelId));
    const creds = JSON.parse(tunnel.credentials);
    await writeTunnelConfigs(tunnelId, creds.AccountTag, creds.TunnelSecret, allRules);

    // 4. Restart tunnel if active
    const isLinux = process.platform === "linux";
    if (isLinux) {
      const isActive = runCmd(`systemctl is-active cloudflared-${tunnelId}`) === "active";
      if (isActive) {
        execSync(`systemctl restart cloudflared-${tunnelId}`, { stdio: "pipe" });
      }
    }

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

/**
 * POST /api/tunnels/:id/control
 * Start, Stop, or Restart the tunnel's systemd daemon
 */
tunnelsRouter.post("/:id/control", async (c) => {
  const id = c.req.param("id");
  const { action } = await c.req.json<{ action: "start" | "stop" | "restart" }>();

  if (!action || !["start", "stop", "restart"].includes(action)) {
    return c.json({ error: "Invalid action. Use start, stop, or restart." }, 400);
  }

  const [tunnel] = await db.select().from(cloudflareTunnels).where(eq(cloudflareTunnels.id, id));
  if (!tunnel) {
    return c.json({ error: "Tunnel not found" }, 404);
  }

  const isLinux = process.platform === "linux";

  try {
    if (isLinux) {
      if (action === "start") {
        execSync(`systemctl enable cloudflared-${id}`, { stdio: "pipe" });
        execSync(`systemctl start cloudflared-${id}`, { stdio: "pipe" });
      } else if (action === "stop") {
        execSync(`systemctl stop cloudflared-${id}`, { stdio: "pipe" });
        execSync(`systemctl disable cloudflared-${id}`, { stdio: "pipe" });
      } else if (action === "restart") {
        execSync(`systemctl restart cloudflared-${id}`, { stdio: "pipe" });
      }
    } else {
      // Mock control updates status in database for simulation
      await db
        .update(cloudflareTunnels)
        .set({ status: action === "stop" ? "inactive" : "active" })
        .where(eq(cloudflareTunnels.id, id));
    }

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: `Systemd operation failed: ${err.message}` }, 500);
  }
});

/**
 * GET /api/tunnels/:id/logs
 * Read logs for the tunnel from journalctl (mock logs on Windows)
 */
tunnelsRouter.get("/:id/logs", async (c) => {
  const id = c.req.param("id");
  const [tunnel] = await db.select().from(cloudflareTunnels).where(eq(cloudflareTunnels.id, id));
  if (!tunnel) {
    return c.json({ error: "Tunnel not found" }, 404);
  }

  const isLinux = process.platform === "linux";
  let logs = "";

  if (isLinux) {
    try {
      logs = execSync(`journalctl -u cloudflared-${id} -n 100 --no-pager`, { stdio: "pipe" }).toString().trim();
    } catch {
      logs = `No log output found. Ensure the systemd service cloudflared-${id} is running.`;
    }
  } else {
    // Mock systemd journal logs
    const now = new Date().toISOString();
    logs = `
${now} [INF] Starting tunnel daemon...
${now} [INF] Version 2026.5.0
${now} [INF] OS: windows, Arch: amd64
${now} [INF] Settings: config=data/cloudflared/${id}.yml creds=data/cloudflared/${id}.json
${now} [INF] Connection 0 registered at edge SIN (Singapore)
${now} [INF] Connection 1 registered at edge HKG (Hong Kong)
${now} [INF] Connection 2 registered at edge NRT (Tokyo)
${now} [INF] Connection 3 registered at edge KUL (Kuala Lumpur)
${now} [INF] Tunnel is active and routing ingress configurations successfully.
`;
  }

  return c.json({ logs });
});
