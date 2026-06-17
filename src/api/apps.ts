import { Hono } from "hono";
import { db } from "../db/index";
import { customServices, settings, cloudflareTunnels, tunnelIngressRules } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { exec, execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getCloudflareSettings, getZoneIdForHostname, writeTunnelConfigs } from "./tunnels";

export const appsRouter = new Hono();

// Helper to execute commands and return stdout
function runCmd(cmd: string): string {
  try {
    return execSync(cmd, { stdio: "pipe", timeout: 6000 }).toString().trim();
  } catch (err: any) {
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    throw new Error(stderr || err.message || "Execution failed");
  }
}

// ── App Store Docker Templates ───────────────────────────────────────
const STORE_APPS = [
  {
    id: "pihole",
    name: "Pi-hole",
    description: "DNS Sinkhole for network-wide ad & tracker blocking. Safeguard your family browsing.",
    icon: "Shield",
    port: 8080,
    installCmd: 'docker run -d --name pihole -p 53:53/tcp -p 53:53/udp -p 8080:80 -e TZ=Asia/Jakarta -e WEBPASSWORD=admin --restart=unless-stopped pihole/pihole:latest',
  },
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    description: "Alternative Bitwarden server written in Rust. Secure password manager, lightweight for 2GB RAM.",
    icon: "Lock",
    port: 8081,
    installCmd: 'docker run -d --name vaultwarden -v ./data/vaultwarden:/data/ -p 8081:80 --restart=unless-stopped vaultwarden/server:latest',
  },
  {
    id: "tailscale",
    name: "Tailscale",
    description: "Zero-config VPN tunnel. Access your Akari STB securely from anywhere in the world without port forwarding.",
    icon: "Link",
    port: 0, // Host network
    installCmd: 'docker run -d --name tailscale --state=host -v /var/lib:/var/lib -v /dev/net/tun:/dev/net/tun --network=host --privileged --restart=unless-stopped tailscale/tailscale:latest',
  },
  {
    id: "jellyfin",
    name: "Jellyfin",
    description: "Personal media streaming server. Auto-mounts /mnt/intip_sdcard for direct play streaming.",
    icon: "Tv",
    port: 8096,
    installCmd: 'docker run -d --name jellyfin -p 8096:8096 -v ./data/jellyfin/config:/config -v ./data/jellyfin/cache:/cache -v /mnt/intip_sdcard:/media --restart=unless-stopped jellyfin/jellyfin:latest',
  },
  {
    id: "homepage",
    name: "Homepage",
    description: "A highly customizable and modern home server dashboard. Monitor your services in one premium UI.",
    icon: "Grid",
    port: 3000,
    installCmd: 'docker run -d --name homepage -p 3000:3000 -v ./data/homepage:/app/config --restart=unless-stopped ghcr.io/gethomepage/homepage:latest',
  }
];

// In-memory mock Docker state for Windows development
const mockDockerState: Record<string, { status: string; installed: boolean }> = {
  pihole: { status: "not_installed", installed: false },
  vaultwarden: { status: "not_installed", installed: false },
  tailscale: { status: "not_installed", installed: false },
  jellyfin: { status: "not_installed", installed: false },
  homepage: { status: "not_installed", installed: false }
};

// ── GET STORE: List Store Apps & Status ──────────────────────────────
appsRouter.get("/store", async (c) => {
  const isLinux = process.platform === "linux";
  
  if (!isLinux) {
    // Return mock data for Windows development
    const list = STORE_APPS.map(app => {
      const state = mockDockerState[app.id] || { status: "not_installed", installed: false };
      return {
        ...app,
        status: state.status, // running | stopped | not_installed
        installed: state.installed,
        url: app.port ? `http://${c.req.header("host")?.split(":")[0]}:${app.port}` : null
      };
    });
    return c.json(list);
  }

  // Linux parsing
  try {
    // Check if docker CLI is available
    const hasDocker = runCmd("which docker || true") !== "";
    if (!hasDocker) {
      return c.json(STORE_APPS.map(app => ({
        ...app,
        status: "docker_missing",
        installed: false,
      })));
    }

    // Get all docker containers
    const dockerPs = runCmd("docker ps -a --format '{{.Names}}|{{.State}}'").split("\n").filter(Boolean);
    const containerStates = new Map<string, string>();
    for (const row of dockerPs) {
      const [name, state] = row.split("|");
      if (name) containerStates.set(name.trim(), state.trim());
    }

    const list = STORE_APPS.map(app => {
      const state = containerStates.get(app.id);
      let status = "not_installed";
      let installed = false;

      if (state) {
        installed = true;
        status = state === "running" ? "running" : "stopped";
      }

      return {
        ...app,
        status,
        installed,
        url: app.port ? `http://${c.req.header("host")?.split(":")[0]}:${app.port}` : null
      };
    });

    return c.json(list);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── POST INSTALL: Install App ────────────────────────────────────────
appsRouter.post("/store/:appId/install", async (c) => {
  const appId = c.req.param("appId");
  const app = STORE_APPS.find(a => a.id === appId);
  if (!app) return c.json({ error: "App not found" }, 404);

  const isLinux = process.platform === "linux";

  if (!isLinux) {
    mockDockerState[appId] = { status: "running", installed: true };
    return c.json({ success: true, message: `App ${app.name} installed successfully (mock).` });
  }

  try {
    // Check if container already exists
    const containerCheck = runCmd(`docker ps -a --filter name=^/${appId}$ --format '{{.Names}}'`);
    if (containerCheck) {
      // Container exists, just start it
      runCmd(`docker start ${appId}`);
    } else {
      // Container doesn't exist, create it
      // Ensure data folders exist for mapped volumes
      if (appId === "vaultwarden") {
        fs.mkdirSync("./data/vaultwarden", { recursive: true });
      } else if (appId === "jellyfin") {
        fs.mkdirSync("./data/jellyfin/config", { recursive: true });
        fs.mkdirSync("./data/jellyfin/cache", { recursive: true });
      } else if (appId === "homepage") {
        fs.mkdirSync("./data/homepage", { recursive: true });
      }
      runCmd(app.installCmd);
    }
    return c.json({ success: true, message: `App ${app.name} installed and started.` });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── POST CONTROL: Start/Stop Docker Container ────────────────────────
appsRouter.post("/store/:appId/control", async (c) => {
  const appId = c.req.param("appId");
  const body = await c.req.json<{ action: "start" | "stop" }>();
  
  if (body.action !== "start" && body.action !== "stop") {
    return c.json({ error: "Invalid action. Must be start or stop" }, 400);
  }

  const isLinux = process.platform === "linux";

  if (!isLinux) {
    mockDockerState[appId] = { status: body.action === "start" ? "running" : "stopped", installed: true };
    return c.json({ success: true });
  }

  try {
    runCmd(`docker ${body.action} ${appId}`);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── DELETE UNINSTALL: Remove Container ───────────────────────────────
appsRouter.delete("/store/:appId/uninstall", async (c) => {
  const appId = c.req.param("appId");
  const isLinux = process.platform === "linux";

  if (!isLinux) {
    mockDockerState[appId] = { status: "not_installed", installed: false };
    return c.json({ success: true });
  }

  try {
    runCmd(`docker rm -f ${appId}`);
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── GET CUSTOM SERVICES: List registered systemd services ────────────
appsRouter.get("/custom", async (c) => {
  const list = await db.select().from(customServices);
  const isLinux = process.platform === "linux";

  const updatedList = list.map(service => {
    let liveStatus = service.status;
    let cpuPercent = 0;
    let memMb = 0;

    if (isLinux) {
      try {
        if (service.status === "building") {
          liveStatus = "building";
        } else {
          const isActive = runCmd(`systemctl is-active ${service.name} || true`) === "active";
          liveStatus = isActive ? "running" : "stopped";
        }

        // Query memory/cpu of systemd service using systemd-show
        if (liveStatus === "running") {
          const mainPid = parseInt(runCmd(`systemctl show -p MainPID --value ${service.name}`) || "0");
          if (mainPid > 0) {
            // Read resources via ps
            const psInfo = runCmd(`ps -p ${mainPid} -o %cpu,%mem,rss --no-headers || true`).trim().split(/\s+/);
            if (psInfo.length >= 3) {
              cpuPercent = parseFloat(psInfo[0]) || 0;
              const rssKb = parseInt(psInfo[2]) || 0;
              memMb = Math.round(rssKb / 1024);
            }
          }
        }
      } catch {
        liveStatus = "error";
      }
    } else {
      // Mock fluctuated values for Windows dev view
      if (liveStatus === "running") {
        cpuPercent = parseFloat((0.5 + Math.random() * 4).toFixed(1));
        memMb = Math.round(25 + Math.random() * 10);
      }
    }

    return {
      ...service,
      status: liveStatus,
      resources: {
        cpu: cpuPercent,
        memory: memMb
      }
    };
  });

  return c.json(updatedList);
});

// ── POST CUSTOM SERVICE: Register new custom systemd service (PaaS app) ──
appsRouter.post("/custom", async (c) => {
  const body = await c.req.json<{
    name: string;
    description?: string;
    cwd: string;
    command: string;
    envVars?: Record<string, string>;
    
    // New GitHub & Cloudflare fields
    githubRepo?: string;
    githubBranch?: string;
    buildCommand?: string;
    port?: number;
    tunnelId?: string;
    hostname?: string;
  }>();

  if (!body.name || !body.cwd || !body.command) {
    return c.json({ error: "Name, cwd, and command are required" }, 400);
  }

  // Validate service name: only allow alphanumeric, dashes, and underscores
  if (!/^[a-zA-Z0-9-_]+$/.test(body.name)) {
    return c.json({ error: "Service name can only contain alphanumeric characters, dashes, and underscores" }, 400);
  }

  const isLinux = process.platform === "linux";
  const webhookSecret = crypto.randomBytes(20).toString("hex");

  // 1. Git clone if githubRepo is provided
  if (body.githubRepo) {
    const hasFolder = fs.existsSync(body.cwd);
    const isEmpty = hasFolder ? fs.readdirSync(body.cwd).length === 0 : true;

    if (isEmpty) {
      try {
        const [patSetting] = await db.select().from(settings).where(eq(settings.key, "github_pat"));
        const pat = patSetting?.value || "";
        
        const cloneUrl = pat 
          ? `https://${pat}@github.com/${body.githubRepo.trim()}.git`
          : `https://github.com/${body.githubRepo.trim()}.git`;

        fs.mkdirSync(body.cwd, { recursive: true });
        runCmd(`git clone -b ${body.githubBranch || "main"} ${cloneUrl} ${body.cwd}`);
      } catch (err: any) {
        return c.json({ error: `Failed to clone repository: ${err.message}` }, 500);
      }
    }
  } else {
    if (isLinux && !fs.existsSync(body.cwd)) {
      return c.json({ error: `Working directory does not exist: ${body.cwd}` }, 400);
    }
  }

  // 2. Cloudflare Ingress mapping and DNS CNAME setup
  let dnsRecordId = "";
  if (body.tunnelId && body.hostname) {
    if (!body.port) {
      return c.json({ error: "Local port is required to expose via Cloudflare Tunnel" }, 400);
    }

    const [tunnel] = await db.select().from(cloudflareTunnels).where(eq(cloudflareTunnels.id, body.tunnelId));
    if (!tunnel) {
      return c.json({ error: "Selected Cloudflare Tunnel not found" }, 404);
    }

    const { apiToken } = await getCloudflareSettings();
    
    try {
      if (apiToken && apiToken !== "mock_token") {
        const zoneId = await getZoneIdForHostname(apiToken, body.hostname.trim());
        const dnsRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "CNAME",
            name: body.hostname.trim(),
            content: `${body.tunnelId}.cfargotunnel.com`,
            ttl: 1,
            proxied: true,
          }),
        });
        const dnsJson = await dnsRes.json() as any;
        if (!dnsJson.success) {
          throw new Error(dnsJson.errors?.[0]?.message || "Failed to create DNS record");
        }
        dnsRecordId = dnsJson.result.id;
      } else {
        dnsRecordId = `mock_app_dns_${crypto.randomUUID()}`;
      }

      // Save Ingress Rule
      await db.insert(tunnelIngressRules).values({
        tunnelId: body.tunnelId,
        hostname: body.hostname.trim(),
        service: `http://localhost:${body.port}`,
        dnsRecordId: dnsRecordId || null,
      });

      // Re-generate YAML configs
      const allRules = await db.select().from(tunnelIngressRules).where(eq(tunnelIngressRules.tunnelId, body.tunnelId));
      const creds = JSON.parse(tunnel.credentials);
      await writeTunnelConfigs(body.tunnelId, creds.AccountTag, creds.TunnelSecret, allRules);

      // Restart tunnel service
      if (isLinux) {
        const isActive = runCmd(`systemctl is-active cloudflared-${body.tunnelId}`) === "active";
        if (isActive) {
          execSync(`systemctl restart cloudflared-${body.tunnelId}`, { stdio: "pipe" });
        }
      }
    } catch (err: any) {
      return c.json({ error: `Cloudflare Tunnel routing setup failed: ${err.message}` }, 500);
    }
  }

  // 3. Write systemd unit configuration file
  const serviceUnitName = `etteum-app-${body.name}`;
  if (isLinux) {
    try {
      let envLines = "";
      if (body.envVars && Object.keys(body.envVars).length > 0) {
        envLines = Object.entries(body.envVars)
          .map(([key, val]) => `Environment="${key}=${val}"`)
          .join("\n");
      }

      const serviceContent = `[Unit]
Description=Etteum App ${body.name}
After=network.target

[Service]
Type=simple
WorkingDirectory=${body.cwd}
ExecStart=${body.command}
Restart=on-failure
RestartSec=5
${envLines}
User=root

[Install]
WantedBy=multi-user.target
`;
      const servicePath = `/etc/systemd/system/${serviceUnitName}.service`;
      fs.writeFileSync(servicePath, serviceContent);
      runCmd("systemctl daemon-reload");
      runCmd(`systemctl enable ${serviceUnitName}`);
    } catch (err: any) {
      return c.json({ error: `Systemd configuration failed: ${err.message}` }, 500);
    }
  }

  // 4. Save to database first to get the ID
  let initialStatus = body.buildCommand ? "building" : "running";
  let inserted;
  try {
    const [row] = await db
      .insert(customServices)
      .values({
        name: serviceUnitName,
        description: body.description || null,
        cwd: body.cwd,
        command: body.command,
        envVars: body.envVars ? JSON.stringify(body.envVars) : null,
        status: initialStatus,
        githubRepo: body.githubRepo || null,
        githubBranch: body.githubBranch || "main",
        buildCommand: body.buildCommand || null,
        port: body.port || null,
        tunnelId: body.tunnelId || null,
        hostname: body.hostname || null,
        webhookSecret
      })
      .returning();
    inserted = row;
  } catch (err: any) {
    return c.json({ error: `Database save failed: ${err.message}` }, 500);
  }

  // 5. Trigger build in background or start immediately
  const projectDir = process.cwd();
  const dbIndex = path.join(projectDir, "src", "db", "index.ts").replace(/\\/g, "/");
  const dbSchema = path.join(projectDir, "src", "db", "schema.ts").replace(/\\/g, "/");

  if (body.buildCommand) {
    if (isLinux) {
      const successCmd = `bun -e "import { db } from '${dbIndex}'; import { customServices } from '${dbSchema}'; import { eq } from 'drizzle-orm'; await db.update(customServices).set({ status: 'running', updatedAt: new Date() }).where(eq(customServices.id, ${inserted.id}));"`;
      const errorCmd = `bun -e "import { db } from '${dbIndex}'; import { customServices } from '${dbSchema}'; import { eq } from 'drizzle-orm'; await db.update(customServices).set({ status: 'error', updatedAt: new Date() }).where(eq(customServices.id, ${inserted.id}));"`;

      const script = `(cd ${body.cwd} && (${body.buildCommand}) > .etteum-build.log 2>&1) && (systemctl restart ${serviceUnitName} && ${successCmd}) || ${errorCmd}`;
      const child = spawn("bash", ["-c", script], {
        detached: true,
        stdio: "ignore",
        cwd: body.cwd
      });
      child.unref();
    } else {
      setTimeout(async () => {
        try {
          await db
            .update(customServices)
            .set({ status: "running", updatedAt: new Date() })
            .where(eq(customServices.id, inserted.id));
          console.log(`Mock build complete for app: ${body.name}`);
        } catch (e: any) {
          console.error("Mock build status update failed:", e.message);
        }
      }, 4000);
    }
  } else {
    if (isLinux) {
      try {
        runCmd(`systemctl start ${serviceUnitName}`);
      } catch {}
    }
  }
});

// ── POST CUSTOM CONTROL: Start/Stop/Restart service ──────────────────
appsRouter.post("/custom/:id/control", async (c) => {
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ action: "start" | "stop" | "restart" }>();

  if (body.action !== "start" && body.action !== "stop" && body.action !== "restart") {
    return c.json({ error: "Invalid action. Must be start, stop or restart" }, 400);
  }

  const [service] = await db.select().from(customServices).where(eq(customServices.id, id));
  if (!service) return c.json({ error: "Service not found" }, 404);

  const isLinux = process.platform === "linux";

  if (isLinux) {
    try {
      runCmd(`systemctl ${body.action} ${service.name}`);
    } catch (err: any) {
      return c.json({ error: `Failed to control systemd unit: ${err.message}` }, 500);
    }
  }

  // Update status in db
  let newStatus = service.status;
  if (body.action === "start" || body.action === "restart") newStatus = "running";
  if (body.action === "stop") newStatus = "stopped";

  await db
    .update(customServices)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(customServices.id, id));

  return c.json({ success: true, status: newStatus });
});

// ── DELETE CUSTOM SERVICE: Stop, disable, cleanup domain and service file ─
appsRouter.delete("/custom/:id", async (c) => {
  const id = Number(c.req.param("id"));

  const [service] = await db.select().from(customServices).where(eq(customServices.id, id));
  if (!service) return c.json({ error: "Service not found" }, 404);

  const isLinux = process.platform === "linux";

  // 1. Cleanup Cloudflare Tunnel routing rule and DNS CNAME record
  if (service.tunnelId && service.hostname) {
    try {
      const [rule] = await db
        .select()
        .from(tunnelIngressRules)
        .where(and(eq(tunnelIngressRules.tunnelId, service.tunnelId), eq(tunnelIngressRules.hostname, service.hostname)));
      
      if (rule) {
        const { apiToken } = await getCloudflareSettings();
        if (apiToken && apiToken !== "mock_token" && rule.dnsRecordId && !rule.dnsRecordId.startsWith("mock_")) {
          try {
            const zoneId = await getZoneIdForHostname(apiToken, rule.hostname);
            await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${rule.dnsRecordId}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${apiToken}` }
            });
          } catch (dnsErr: any) {
            console.warn("Clean CNAME failed during app deletion:", dnsErr.message);
          }
        }

        // Delete from local Ingress rules
        await db.delete(tunnelIngressRules).where(eq(tunnelIngressRules.id, rule.id));

        // Re-generate YAML configs
        const [tunnel] = await db.select().from(cloudflareTunnels).where(eq(cloudflareTunnels.id, service.tunnelId));
        if (tunnel) {
          const creds = JSON.parse(tunnel.credentials);
          const allRules = await db.select().from(tunnelIngressRules).where(eq(tunnelIngressRules.tunnelId, service.tunnelId));
          await writeTunnelConfigs(service.tunnelId, creds.AccountTag, creds.TunnelSecret, allRules);
          
          if (isLinux) {
            const isActive = runCmd(`systemctl is-active cloudflared-${service.tunnelId}`) === "active";
            if (isActive) {
              execSync(`systemctl restart cloudflared-${service.tunnelId}`, { stdio: "pipe" });
            }
          }
        }
      }
    } catch (err: any) {
      console.error("Failed to clean up Cloudflare route during app deletion:", err.message);
    }
  }

  // 2. Stop, disable and delete systemd service file
  if (isLinux) {
    try {
      runCmd(`systemctl stop ${service.name} || true`);
      runCmd(`systemctl disable ${service.name} || true`);
      
      const servicePath = `/etc/systemd/system/${service.name}.service`;
      if (fs.existsSync(servicePath)) {
        fs.unlinkSync(servicePath);
      }
      runCmd("systemctl daemon-reload");
    } catch (err: any) {
      return c.json({ error: `Failed to delete systemd service: ${err.message}` }, 500);
    }
  }

  // 3. Delete from DB
  await db.delete(customServices).where(eq(customServices.id, id));

  return c.json({ success: true });
});

// ── GET CUSTOM SERVICE LOGS: Read journalctl logs ─────────────────────
appsRouter.get("/custom/:id/logs", async (c) => {
  const id = Number(c.req.param("id"));

  const [service] = await db.select().from(customServices).where(eq(customServices.id, id));
  if (!service) return c.json({ error: "Service not found" }, 404);

  const isLinux = process.platform === "linux";

  if (!isLinux) {
    const mockLogs = [
      `[mock-service] [${new Date().toLocaleTimeString()}] Listening on port 8080`,
      `[mock-service] [${new Date().toLocaleTimeString()}] Successfully connected to database`,
      `[mock-service] [${new Date().toLocaleTimeString()}] Telegram Bot polling started...`,
      `[mock-service] [${new Date().toLocaleTimeString()}] Client request accepted from IP: 192.168.1.10`,
      `[mock-service] [${new Date().toLocaleTimeString()}] Info: Bot parsed 5 tasks, 0 errors.`
    ];
    return c.json({ logs: mockLogs.join("\n") });
  }

  try {
    const logs = runCmd(`journalctl -u ${service.name} -n 80 --no-pager || true`);
    return c.json({ logs });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ── GET CUSTOM BUILD LOGS: Read build stdout file ──────────────────────
appsRouter.get("/custom/:id/build-logs", async (c) => {
  const id = Number(c.req.param("id"));
  const [service] = await db.select().from(customServices).where(eq(customServices.id, id));
  if (!service) return c.json({ error: "Service not found" }, 404);
  
  const logPath = `${service.cwd}/.etteum-build.log`;
  if (fs.existsSync(logPath)) {
    try {
      const logs = fs.readFileSync(logPath, "utf8");
      return c.json({ logs });
    } catch (err: any) {
      return c.json({ error: `Failed to read build logs: ${err.message}` }, 500);
    }
  }
  return c.json({ logs: "No build logs found. Make sure the app has a build command configured." });
});

// ── POST CUSTOM WEBHOOK DEPLOY: Pull code, build, and restart app ──────
appsRouter.post("/custom/:id/webhook-deploy", async (c) => {
  const id = Number(c.req.param("id"));
  const signatureHeader = c.req.header("x-hub-signature-256") || "";
  const rawBody = await c.req.text();

  const [service] = await db.select().from(customServices).where(eq(customServices.id, id));
  if (!service) return c.json({ error: "App not found" }, 404);

  const secret = service.webhookSecret || "";

  if (secret) {
    if (!signatureHeader) {
      return c.json({ error: "Missing x-hub-signature-256 header" }, 401);
    }
    const parts = signatureHeader.split("=");
    if (parts.length !== 2 || parts[0] !== "sha256") {
      return c.json({ error: "Invalid signature format" }, 400);
    }
    const expected = parts[1];
    const hmac = crypto.createHmac("sha256", secret);
    const actual = hmac.update(rawBody).digest("hex");
    
    try {
      const isMatch = crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
      if (!isMatch) {
        return c.json({ error: "Signature mismatch" }, 401);
      }
    } catch {
      return c.json({ error: "Signature verification failed" }, 401);
    }
  }

  // Parse payload and check branch
  try {
    const payload = JSON.parse(rawBody);
    const targetBranch = service.githubBranch || "main";
    if (payload.ref && payload.ref !== `refs/heads/${targetBranch}`) {
      return c.json({ message: `Skipping deploy for non-target branch: ${payload.ref}` });
    }
  } catch (e) {
    console.warn("Webhook payload not JSON, continuing anyway");
  }

  // Update status to building
  await db
    .update(customServices)
    .set({ status: "building", updatedAt: new Date() })
    .where(eq(customServices.id, id));

  const isLinux = process.platform === "linux";
  const projectDir = process.cwd();
  const dbIndex = path.join(projectDir, "src", "db", "index.ts").replace(/\\/g, "/");
  const dbSchema = path.join(projectDir, "src", "db", "schema.ts").replace(/\\/g, "/");

  if (isLinux) {
    const successCmd = `bun -e "import { db } from '${dbIndex}'; import { customServices } from '${dbSchema}'; import { eq } from 'drizzle-orm'; await db.update(customServices).set({ status: 'running', updatedAt: new Date() }).where(eq(customServices.id, ${service.id}));"`;
    const errorCmd = `bun -e "import { db } from '${dbIndex}'; import { customServices } from '${dbSchema}'; import { eq } from 'drizzle-orm'; await db.update(customServices).set({ status: 'error', updatedAt: new Date() }).where(eq(customServices.id, ${service.id}));"`;

    const gitPull = service.githubRepo ? `git pull && ` : "";
    const buildCmd = service.buildCommand ? `(${service.buildCommand}) > .etteum-build.log 2>&1 && ` : "";
    const script = `cd ${service.cwd} && ${gitPull}${buildCmd}systemctl restart ${service.name} && ${successCmd} || ${errorCmd}`;

    const child = spawn("bash", ["-c", script], {
      detached: true,
      stdio: "ignore",
      cwd: service.cwd,
    });
    child.unref();
  } else {
    console.log(`Mocking webhook deployment for app ${service.name} on Windows.`);
    setTimeout(async () => {
      try {
        await db
          .update(customServices)
          .set({ status: "running", updatedAt: new Date() })
          .where(eq(customServices.id, id));
        console.log(`Mock webhook deploy complete for app: ${service.name}`);
      } catch (e: any) {
        console.error("Mock webhook status update failed:", e.message);
      }
    }, 4000);
  }

  return c.json({ success: true, message: "App deployment triggered in background" });
});

// ── POST CUSTOM REDEPLOY: Pull code, build, and restart app (user triggered) ──
appsRouter.post("/custom/:id/redeploy", async (c) => {
  const id = Number(c.req.param("id"));
  const [service] = await db.select().from(customServices).where(eq(customServices.id, id));
  if (!service) return c.json({ error: "App not found" }, 404);

  // Update status to building
  await db
    .update(customServices)
    .set({ status: "building", updatedAt: new Date() })
    .where(eq(customServices.id, id));

  const isLinux = process.platform === "linux";
  const projectDir = process.cwd();
  const dbIndex = path.join(projectDir, "src", "db", "index.ts").replace(/\\/g, "/");
  const dbSchema = path.join(projectDir, "src", "db", "schema.ts").replace(/\\/g, "/");

  if (isLinux) {
    const successCmd = `bun -e "import { db } from '${dbIndex}'; import { customServices } from '${dbSchema}'; import { eq } from 'drizzle-orm'; await db.update(customServices).set({ status: 'running', updatedAt: new Date() }).where(eq(customServices.id, ${service.id}));"`;
    const errorCmd = `bun -e "import { db } from '${dbIndex}'; import { customServices } from '${dbSchema}'; import { eq } from 'drizzle-orm'; await db.update(customServices).set({ status: 'error', updatedAt: new Date() }).where(eq(customServices.id, ${service.id}));"`;

    const gitPull = service.githubRepo ? `git pull && ` : "";
    const buildCmd = service.buildCommand ? `(${service.buildCommand}) > .etteum-build.log 2>&1 && ` : "";
    const script = `cd ${service.cwd} && ${gitPull}${buildCmd}systemctl restart ${service.name} && ${successCmd} || ${errorCmd}`;

    const child = spawn("bash", ["-c", script], {
      detached: true,
      stdio: "ignore",
      cwd: service.cwd,
    });
    child.unref();
  } else {
    console.log(`Mocking redeployment for app ${service.name} on Windows.`);
    setTimeout(async () => {
      try {
        await db
          .update(customServices)
          .set({ status: "running", updatedAt: new Date() })
          .where(eq(customServices.id, id));
        console.log(`Mock redeploy complete for app: ${service.name}`);
      } catch (e: any) {
        console.error("Mock redeploy status update failed:", e.message);
      }
    }, 4000);
  }

  return c.json({ success: true, message: "App redeployment triggered in background" });
});

// Helper: Parse Git remote URL into owner/repo
function parseGitRemote(url: string): { owner: string; repo: string } | null {
  if (!url) return null;
  const match = url.match(/github\.com[\/:]([^\/]+)\/([^\/\s\.]+)/);
  if (match) {
    const owner = match[1];
    let repo = match[2];
    if (repo.endsWith(".git")) {
      repo = repo.slice(0, -4);
    }
    return { owner, repo };
  }
  return null;
}

// ── POST CUSTOM GITHUB WEBHOOK: Auto-register app webhook on GitHub ────
appsRouter.post("/custom/:id/github-hook", async (c) => {
  const id = Number(c.req.param("id"));
  const [service] = await db.select().from(customServices).where(eq(customServices.id, id));
  if (!service) return c.json({ error: "App not found" }, 404);

  if (!service.githubRepo) {
    return c.json({ error: "This app is not connected to a GitHub repository" }, 400);
  }

  if (!service.hostname) {
    return c.json({ error: "This app does not have a public domain hostname configured" }, 400);
  }

  const [patSetting] = await db.select().from(settings).where(eq(settings.key, "github_pat"));
  const token = patSetting?.value || "";
  if (!token) {
    return c.json({ error: "GitHub Personal Access Token (PAT) not configured in Settings" }, 400);
  }

  const gitInfo = parseGitRemote(`https://github.com/${service.githubRepo}`);
  if (!gitInfo) {
    return c.json({ error: "Failed to parse GitHub repository details" }, 400);
  }

  const { owner, repo } = gitInfo;
  const publicWebhookUrl = `https://${service.hostname}/api/apps/custom/${id}/webhook-deploy`;
  const secret = service.webhookSecret || "";

  try {
    const listRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "Etteum-Server"
      }
    });
    const listJson = await listRes.json() as any;

    let existingHookId = null;
    if (Array.isArray(listJson)) {
      const matchingHook = listJson.find(h => h.config && h.config.url === publicWebhookUrl);
      if (matchingHook) {
        existingHookId = matchingHook.id;
      }
    }

    if (existingHookId) {
      const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${existingHookId}`, {
        method: "PATCH",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "Etteum-Server"
        },
        body: JSON.stringify({
          active: true,
          events: ["push"],
          config: {
            url: publicWebhookUrl,
            content_type: "json",
            secret: secret
          }
        })
      });
      const updateJson = await updateRes.json() as any;
      if (updateJson.id) {
        return c.json({ success: true, message: `Webhook updated on GitHub: ${publicWebhookUrl}` });
      } else {
        return c.json({ error: updateJson.message || "Failed to update webhook on GitHub" }, 500);
      }
    } else {
      const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
        method: "POST",
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "User-Agent": "Etteum-Server"
        },
        body: JSON.stringify({
          name: "web",
          active: true,
          events: ["push"],
          config: {
            url: publicWebhookUrl,
            content_type: "json",
            secret: secret
          }
        })
      });
      const createJson = await createRes.json() as any;
      if (createJson.id) {
        return c.json({ success: true, message: `Webhook created on GitHub: ${publicWebhookUrl}` });
      } else {
        return c.json({ error: createJson.message || "Failed to create webhook on GitHub" }, 500);
      }
    }
  } catch (err: any) {
    return c.json({ error: `Failed to register webhook on GitHub: ${err.message}` }, 500);
  }
});
