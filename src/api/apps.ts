import { Hono } from "hono";
import { db } from "../db/index";
import { customServices } from "../db/schema";
import { eq } from "drizzle-orm";
import { execSync } from "child_process";
import fs from "fs";

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
        const isActive = runCmd(`systemctl is-active ${service.name} || true`) === "active";
        liveStatus = isActive ? "running" : "stopped";

        // Query memory/cpu of systemd service using systemd-show
        if (isActive) {
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

// ── POST CUSTOM SERVICE: Register new custom systemd service ──────────
appsRouter.post("/custom", async (c) => {
  const body = await c.req.json<{
    name: string;
    description?: string;
    cwd: string;
    command: string;
    envVars?: Record<string, string>;
  }>();

  if (!body.name || !body.cwd || !body.command) {
    return c.json({ error: "Name, cwd, and command are required" }, 400);
  }

  // Validate service name: only allow alphanumeric, dashes, and underscores
  if (!/^[a-zA-Z0-9-_]+$/.test(body.name)) {
    return c.json({ error: "Service name can only contain alphanumeric characters, dashes, and underscores" }, 400);
  }

  const isLinux = process.platform === "linux";

  if (isLinux) {
    // 1. Verify working directory exists
    if (!fs.existsSync(body.cwd)) {
      return c.json({ error: `Working directory does not exist: ${body.cwd}` }, 400);
    }

    try {
      // 2. Format environment variables for systemd Unit
      let envLines = "";
      if (body.envVars && Object.keys(body.envVars).length > 0) {
        const lines = Object.entries(body.envVars)
          .map(([key, val]) => `Environment="${key}=${val}"`)
          .join("\n");
        envLines = `${lines}`;
      }

      // 3. Construct systemd service content
      const serviceContent = `[Unit]
Description=${body.description || body.name}
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

      const servicePath = `/etc/systemd/system/${body.name}.service`;
      
      // 4. Write systemd file (Requires write access to etc/systemd/system)
      fs.writeFileSync(servicePath, serviceContent);

      // 5. Reload systemd daemon, enable, and start service
      runCmd("systemctl daemon-reload");
      runCmd(`systemctl enable ${body.name}`);
      runCmd(`systemctl start ${body.name}`);
    } catch (err: any) {
      return c.json({ error: `Systemd configuration failed: ${err.message}` }, 500);
    }
  }

  // 6. Save to Database
  try {
    const [inserted] = await db
      .insert(customServices)
      .values({
        name: body.name,
        description: body.description || null,
        cwd: body.cwd,
        command: body.command,
        envVars: body.envVars ? JSON.stringify(body.envVars) : null,
        status: "running"
      })
      .returning();

    return c.json({ success: true, service: inserted });
  } catch (err: any) {
    return c.json({ error: `Database save failed: ${err.message}` }, 500);
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

// ── DELETE CUSTOM SERVICE: Stop, disable, delete service file ────────
appsRouter.delete("/custom/:id", async (c) => {
  const id = Number(c.req.param("id"));

  const [service] = await db.select().from(customServices).where(eq(customServices.id, id));
  if (!service) return c.json({ error: "Service not found" }, 404);

  const isLinux = process.platform === "linux";

  if (isLinux) {
    try {
      // Stop and disable service
      runCmd(`systemctl stop ${service.name} || true`);
      runCmd(`systemctl disable ${service.name} || true`);
      
      // Delete systemd file
      const servicePath = `/etc/systemd/system/${service.name}.service`;
      if (fs.existsSync(servicePath)) {
        fs.unlinkSync(servicePath);
      }
      
      // Reload systemd daemon
      runCmd("systemctl daemon-reload");
    } catch (err: any) {
      return c.json({ error: `Failed to delete systemd service: ${err.message}` }, 500);
    }
  }

  // Delete from DB
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
    // Return mock logs
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
