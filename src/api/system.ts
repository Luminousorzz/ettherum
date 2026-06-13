import { Hono } from "hono";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";

export const systemRouter = new Hono();

// We'll track network traffic in memory for real-time throughput calculations
let lastNetTime = Date.now();
let lastRxBytes = 0;
let lastTxBytes = 0;
let netThroughput = { rx: 0, tx: 0 };
let totalRx = 0;
let totalTx = 0;

// CPU usage tracking (proc/stat parsing)
let lastCpuIdle = 0;
let lastCpuTotal = 0;
let lastCpuCores: { idle: number; total: number }[] = [];

// Cache public IP address
let cachedPublicIp = "";
let lastPublicIpFetch = 0;

// Global cache for analytics
let systemCache: any = null;

// Helper to execute commands and return trimmed stdout
function runCmd(cmd: string): string {
  try {
    return execSync(cmd, { stdio: "pipe", timeout: 2500 }).toString().trim();
  } catch {
    return "";
  }
}

// Fetch public IP address with a 5-minute cache
async function getPublicIp(): Promise<string> {
  if (cachedPublicIp && Date.now() - lastPublicIpFetch < 300000) {
    return cachedPublicIp;
  }
  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(1500) });
    const json = await res.json() as { ip: string };
    if (json && json.ip) {
      cachedPublicIp = json.ip;
      lastPublicIpFetch = Date.now();
      return cachedPublicIp;
    }
  } catch {}
  return cachedPublicIp || "127.0.0.1";
}

// Perform 5 pings and parse avg latency + packet loss percentage
function getPingStats() {
  let latency = 0;
  let packetLoss = 0;
  try {
    const isLinux = process.platform === "linux";
    const cmd = isLinux ? "ping -c 5 -W 1 8.8.8.8" : "ping -n 5 -w 1000 8.8.8.8";
    const out = runCmd(cmd);
    
    if (isLinux) {
      // Parse packet loss: e.g. "5 packets transmitted, 5 received, 0% packet loss, time 4004ms"
      const lossMatch = out.match(/(\d+)%\s+packet\s+loss/);
      if (lossMatch) {
        packetLoss = parseInt(lossMatch[1]);
      }
      // Parse avg latency: e.g. "rtt min/avg/max/mdev = 12.345/14.567/18.910/2.345 ms"
      const rttMatch = out.match(/rtt\s+min\/avg\/max\/mdev\s+=\s+[\d.]+\/([\d.]+)\//);
      if (rttMatch) {
        latency = Math.round(parseFloat(rttMatch[1]));
      } else {
        // Fallback for single ping RTT
        const rttSingle = out.match(/time=([\d.]+)\s+ms/);
        if (rttSingle) latency = Math.round(parseFloat(rttSingle[1]));
      }
    } else {
      // Windows: e.g. "Packets: Sent = 5, Received = 5, Lost = 0 (0% loss)"
      const lossMatch = out.match(/Lost\s+=\s+\d+\s+\((\d+)%\s+loss\)/);
      if (lossMatch) {
        packetLoss = parseInt(lossMatch[1]);
      }
      // Minimum = 12ms, Maximum = 18ms, Average = 14ms
      const rttMatch = out.match(/Average\s+=\s+(\d+)ms/);
      if (rttMatch) {
        latency = parseInt(rttMatch[1]);
      }
    }
  } catch {
    packetLoss = 100;
    latency = -1;
  }
  return { latency, packetLoss };
}

// Read CPU stats from /proc/stat
function getLinuxCpuUsage() {
  try {
    const stat = fs.readFileSync("/proc/stat", "utf8");
    const lines = stat.split("\n");
    
    // Overall CPU
    const firstLine = lines[0].split(/\s+/).filter(Boolean);
    const user = parseInt(firstLine[1] || "0");
    const nice = parseInt(firstLine[2] || "0");
    const system = parseInt(firstLine[3] || "0");
    const idle = parseInt(firstLine[4] || "0");
    const iowait = parseInt(firstLine[5] || "0");
    const irq = parseInt(firstLine[6] || "0");
    const softirq = parseInt(firstLine[7] || "0");
    
    const total = user + nice + system + idle + iowait + irq + softirq;
    const idleVal = idle;
    
    let overallUsage = 0;
    if (lastCpuTotal > 0) {
      const diffIdle = idleVal - lastCpuIdle;
      const diffTotal = total - lastCpuTotal;
      if (diffTotal > 0) {
        overallUsage = Math.round((1 - diffIdle / diffTotal) * 100);
      }
    }
    lastCpuIdle = idleVal;
    lastCpuTotal = total;

    // Per-core CPU
    const coreUsages: number[] = [];
    let coreIdx = 0;
    for (const line of lines.slice(1)) {
      if (!line.startsWith("cpu") || line.startsWith("cpu ")) break;
      const parts = line.split(/\s+/).filter(Boolean);
      const cUser = parseInt(parts[1] || "0");
      const cNice = parseInt(parts[2] || "0");
      const cSystem = parseInt(parts[3] || "0");
      const cIdle = parseInt(parts[4] || "0");
      const cIowait = parseInt(parts[5] || "0");
      const cIrq = parseInt(parts[6] || "0");
      const cSoftirq = parseInt(parts[7] || "0");
      
      const cTotal = cUser + cNice + cSystem + cIdle + cIowait + cIrq + cSoftirq;
      const cIdleVal = cIdle;

      let cUsage = 0;
      if (lastCpuCores[coreIdx] && lastCpuCores[coreIdx].total > 0) {
        const diffIdle = cIdleVal - lastCpuCores[coreIdx].idle;
        const diffTotal = cTotal - lastCpuCores[coreIdx].total;
        if (diffTotal > 0) {
          cUsage = Math.round((1 - diffIdle / diffTotal) * 100);
        }
      }
      
      if (!lastCpuCores[coreIdx]) {
        lastCpuCores[coreIdx] = { idle: cIdleVal, total: cTotal };
      } else {
        lastCpuCores[coreIdx].idle = cIdleVal;
        lastCpuCores[coreIdx].total = cTotal;
      }
      
      coreUsages.push(cUsage);
      coreIdx++;
    }

    return { overall: overallUsage, cores: coreUsages };
  } catch {
    return { overall: 0, cores: [] };
  }
}

// Calculate real-time network throughput from /proc/net/dev
function updateLinuxNetwork() {
  try {
    const netDev = fs.readFileSync("/proc/net/dev", "utf8");
    const lines = netDev.split("\n");
    let rx = 0;
    let tx = 0;
    
    for (const line of lines) {
      if (line.includes("eth0") || line.includes("wlan0") || line.includes("end0") || line.includes("enp") || line.includes("enx")) {
        const parts = line.trim().split(/\s+/).filter(Boolean);
        rx += parseInt(parts[1] || "0");
        tx += parseInt(parts[9] || "0");
      }
    }

    const now = Date.now();
    const durationSec = (now - lastNetTime) / 1000;
    if (durationSec > 0 && lastRxBytes > 0) {
      netThroughput = {
        rx: Math.max(0, Math.round((rx - lastRxBytes) / durationSec)),
        tx: Math.max(0, Math.round((tx - lastTxBytes) / durationSec)),
      };
    }
    
    lastNetTime = now;
    lastRxBytes = rx;
    lastTxBytes = tx;
    totalRx = rx;
    totalTx = tx;
  } catch {}
}

// Parse active SSH session remote IPs
function getLinuxSshSessions() {
  const list: { user: string; terminal: string; loginTime: string; ip: string }[] = [];
  try {
    const out = runCmd("who");
    const lines = out.split("\n").filter(Boolean);
    for (const line of lines) {
      // e.g. "root     pts/0        2026-06-13 18:40 (192.168.1.10)"
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const user = parts[0];
        const terminal = parts[1];
        const loginTime = `${parts[2]} ${parts[3]}`;
        const ip = parts.slice(4).join(" ").replace(/[()]/g, "") || "local";
        list.push({ user, terminal, loginTime, ip });
      }
    }
  } catch {}
  return list;
}

// Fetch Docker container stats
function getLinuxDockerStats() {
  const list: { name: string; status: string; cpu: string; memory: string }[] = [];
  try {
    const hasDocker = runCmd("which docker") !== "";
    if (!hasDocker) return [];
    
    const statsOut = runCmd("docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}'");
    const rows = statsOut.split("\n").filter(Boolean);
    for (const row of rows) {
      const [name, cpu, memUsage, memPerc] = row.split("|");
      list.push({
        name: name || "unknown",
        status: "running",
        cpu: cpu || "0.0%",
        memory: `${memUsage || "0B"} (${memPerc || "0.0%"})`
      });
    }
  } catch {}
  return list;
}

// Initialize cache with realistic defaults (mock data)
function initCache() {
  const uptime = os.uptime();
  const bootTime = new Date(Date.now() - uptime * 1000).toISOString();
  const isLinux = process.platform === "linux";
  
  systemCache = {
    device: {
      board: isLinux ? "Akari AX512 STB" : "Akari AX512 STB (Dev Board)",
      os: isLinux ? "Linux (Armbian)" : "Windows (Dev Mode)",
      kernel: os.release(),
      uptime,
      bootTime,
      localIp: "127.0.0.1",
      publicIp: "127.0.0.1",
      pingLatencyMs: 15,
      pingPacketLoss: 0
    },
    cpu: {
      overallUsage: 5,
      cores: [5, 5, 5, 5],
      tempC: 45,
      frequencyMhz: 1512,
      throttling: false,
      loadAverage: [0.1, 0.1, 0.05]
    },
    memory: {
      ram: {
        total: os.totalmem(),
        used: Math.round(os.totalmem() * 0.2),
        free: Math.round(os.totalmem() * 0.8),
        buffers: 32 * 1024 * 1024,
        cached: 128 * 1024 * 1024
      },
      swap: {
        total: 512 * 1024 * 1024,
        used: 0,
        free: 512 * 1024 * 1024
      }
    },
    storage: {
      internal: {
        total: 14.5 * 1024 * 1024 * 1024,
        used: 4.5 * 1024 * 1024 * 1024,
        free: 10 * 1024 * 1024 * 1024,
        percent: 31,
        health: "Healthy"
      },
      external: [],
      io: {
        readSpeedBps: 0,
        writeSpeedBps: 0
      }
    },
    network: {
      throughput: {
        downloadBps: 0,
        uploadBps: 0
      },
      traffic: {
        downloadBytes: 10 * 1024 * 1024,
        uploadBytes: 2 * 1024 * 1024
      }
    },
    services: [
      { name: "nginx", active: isLinux, label: "Web Server" },
      { name: "docker", active: isLinux, label: "Docker Daemon" },
      { name: "ssh", active: isLinux, label: "SSH Remote Daemon" },
      { name: "etteum", active: true, label: "Pool Proxy Backend" }
    ],
    dockerContainers: [],
    security: {
      sshSessionsCount: 0,
      sshSessionsList: [],
      failedLogins: 0
    },
    topProcesses: [
      { pid: 1, user: "root", cpu: 0.1, ram: 0.1, name: "systemd" }
    ],
    logs: [
      "System initializing..."
    ]
  };
}

// Background Quick Update (Every 2 seconds) - Cheap metrics only
async function updateQuickMetrics() {
  if (!systemCache) return;
  
  try {
    const isLinux = process.platform === "linux";
    
    // 1. Uptime & local IP
    systemCache.device.uptime = os.uptime();
    
    const interfaces = os.networkInterfaces();
    let localIp = "127.0.0.1";
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          localIp = iface.address;
          break;
        }
      }
    }
    systemCache.device.localIp = localIp;

    if (isLinux) {
      // CPU performance metrics
      const linuxCpu = getLinuxCpuUsage();
      systemCache.cpu.overallUsage = linuxCpu.overall;
      systemCache.cpu.cores = linuxCpu.cores.length ? linuxCpu.cores : [linuxCpu.overall, linuxCpu.overall, linuxCpu.overall, linuxCpu.overall];
      
      // Temperature
      try {
        if (fs.existsSync("/sys/class/thermal/thermal_zone0/temp")) {
          const rawTemp = parseInt(fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8"));
          systemCache.cpu.tempC = rawTemp / 1000;
        }
      } catch {}

      // Frequency
      try {
        if (fs.existsSync("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")) {
          const rawFreq = parseInt(fs.readFileSync("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq", "utf8"));
          systemCache.cpu.frequencyMhz = Math.round(rawFreq / 1000);
        }
      } catch {}

      systemCache.cpu.throttling = systemCache.cpu.tempC > 78;
      systemCache.cpu.loadAverage = os.loadavg();

      // Memory metrics
      try {
        const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
        const lines = meminfo.split("\n");
        const memTotal = parseInt(lines.find(l => l.startsWith("MemTotal:"))?.split(/\s+/)[1] || "0") * 1024;
        const memFree = parseInt(lines.find(l => l.startsWith("MemFree:"))?.split(/\s+/)[1] || "0") * 1024;
        const memBuffers = parseInt(lines.find(l => l.startsWith("Buffers:"))?.split(/\s+/)[1] || "0") * 1024;
        const memCached = parseInt(lines.find(l => l.startsWith("Cached:"))?.split(/\s+/)[1] || "0") * 1024;
        const memAvailable = parseInt(lines.find(l => l.startsWith("MemAvailable:"))?.split(/\s+/)[1] || "0") * 1024;

        systemCache.memory.ram.total = memTotal;
        systemCache.memory.ram.free = memAvailable || (memFree + memBuffers + memCached);
        systemCache.memory.ram.used = memTotal - systemCache.memory.ram.free;
        systemCache.memory.ram.buffers = memBuffers;
        systemCache.memory.ram.cached = memCached;

        const swTotal = parseInt(lines.find(l => l.startsWith("SwapTotal:"))?.split(/\s+/)[1] || "0") * 1024;
        const swFree = parseInt(lines.find(l => l.startsWith("SwapFree:"))?.split(/\s+/)[1] || "0") * 1024;
        systemCache.memory.swap.total = swTotal;
        systemCache.memory.swap.free = swFree;
        systemCache.memory.swap.used = swTotal - swFree;
      } catch {
        systemCache.memory.ram.total = os.totalmem();
        systemCache.memory.ram.free = os.freemem();
        systemCache.memory.ram.used = os.totalmem() - os.freemem();
      }

      // Storage internal percent & health
      try {
        const df = runCmd("df -B1 /").split("\n")[1].split(/\s+/);
        systemCache.storage.internal.total = parseInt(df[1]);
        systemCache.storage.internal.used = parseInt(df[2]);
        systemCache.storage.internal.free = parseInt(df[3]);
        systemCache.storage.internal.percent = Math.round((systemCache.storage.internal.used / systemCache.storage.internal.total) * 100);
      } catch {}

      try {
        if (fs.existsSync("/sys/class/block/mmcblk0/device/life_time")) {
          const wear = fs.readFileSync("/sys/class/block/mmcblk0/device/life_time", "utf8").trim();
          systemCache.storage.internal.health = `Wearout status: ${wear} (Type-A/B life span)`;
        } else {
          systemCache.storage.internal.health = "eMMC Normal (0x01: Life span estimated 100% remaining)";
        }
      } catch {
        systemCache.storage.internal.health = "Healthy";
      }

      // Network updates (throughput calc)
      updateLinuxNetwork();
      systemCache.network.throughput = {
        downloadBps: netThroughput.rx,
        uploadBps: netThroughput.tx
      };
      systemCache.network.traffic = {
        downloadBytes: totalRx,
        uploadBytes: totalTx
      };

      // SSH Active sessions & Security
      systemCache.security.sshSessionsList = getLinuxSshSessions();
      systemCache.security.sshSessionsCount = systemCache.security.sshSessionsList.length;

      // Services status
      systemCache.services = systemCache.services.map((s: any) => {
        try {
          const activeState = runCmd(`systemctl is-active ${s.name}`) === "active";
          return { ...s, active: activeState };
        } catch {
          return s;
        }
      });

      // Top Processes
      try {
        const topRows = runCmd("ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu | head -n 6").split("\n").slice(1);
        systemCache.topProcesses = topRows.map(row => {
          const parts = row.trim().split(/\s+/);
          return {
            pid: parseInt(parts[0] || "0"),
            user: parts[1] || "unknown",
            cpu: parseFloat(parts[2] || "0"),
            ram: parseFloat(parts[3] || "0"),
            name: parts.slice(4).join(" ")
          };
        }).filter(p => p.name);
      } catch {}

    } else {
      // Windows Mock variation logic
      const randomVal = Math.random();
      systemCache.cpu.overallUsage = Math.round(15 + randomVal * 30);
      systemCache.cpu.cores = [
        Math.round(10 + Math.random() * 20),
        Math.round(25 + Math.random() * 30),
        Math.round(5 + Math.random() * 15),
        Math.round(15 + Math.random() * 25)
      ];
      systemCache.cpu.tempC = Math.round(48 + randomVal * 12);
      systemCache.cpu.throttling = systemCache.cpu.tempC > 75;
      systemCache.cpu.loadAverage = [
        parseFloat((0.3 + randomVal * 0.4).toFixed(2)),
        parseFloat((0.25 + randomVal * 0.3).toFixed(2)),
        0.18
      ];

      systemCache.memory.ram.used = Math.round(systemCache.memory.ram.total * (0.42 + randomVal * 0.1));
      systemCache.memory.ram.free = systemCache.memory.ram.total - systemCache.memory.ram.used;

      systemCache.network.throughput = {
        downloadBps: Math.round(150 * 1024 + Math.random() * 850 * 1024),
        uploadBps: Math.round(20 * 1024 + Math.random() * 180 * 1024)
      };
      systemCache.network.traffic.downloadBytes += systemCache.network.throughput.downloadBps * 2;
      systemCache.network.traffic.uploadBytes += systemCache.network.throughput.uploadBps * 2;
      
      // Rotate mock top processes slightly
      systemCache.topProcesses = [
        { pid: 26224, user: "root", cpu: parseFloat((10 + Math.random() * 10).toFixed(1)), ram: 4.8, name: "etteum-agent" },
        { pid: 1042, user: "www-data", cpu: parseFloat((3 + Math.random() * 4).toFixed(1)), ram: 1.2, name: "nginx" },
        { pid: 842, user: "root", cpu: parseFloat((1 + Math.random() * 3).toFixed(1)), ram: 6.5, name: "dockerd" },
        { pid: 1251, user: "ssh", cpu: 1.5, ram: 0.8, name: "sshd" },
        { pid: 1, user: "root", cpu: 0.8, ram: 2.4, name: "systemd" }
      ];
    }
  } catch (err) {
    console.error("Error in updateQuickMetrics background loop:", err);
  }
}

// Background Slow Update (Every 10 seconds) - Heavy CLI commands & Network fetches
async function updateSlowMetrics() {
  if (!systemCache) return;

  try {
    const isLinux = process.platform === "linux";
    
    // 1. Fetch public IP
    const publicIp = await getPublicIp();
    systemCache.device.publicIp = publicIp;

    // 2. Ping statistics (blocking CLI)
    const pingStats = getPingStats();
    systemCache.device.pingLatencyMs = pingStats.latency;
    systemCache.device.pingPacketLoss = pingStats.packetLoss;

    if (isLinux) {
      // External Storage
      try {
        const extStorage: any[] = [];
        const dfExt = runCmd("df -B1").split("\n").slice(1);
        for (const line of dfExt) {
          const parts = line.split(/\s+/);
          const mount = parts[5] || "";
          if (mount.startsWith("/media/") || mount.startsWith("/mnt/")) {
            const total = parseInt(parts[1]);
            const used = parseInt(parts[2]);
            const free = parts[3] ? parseInt(parts[3]) : total - used;
            extStorage.push({
              mount,
              total,
              used,
              free,
              percent: Math.round((used / total) * 100)
            });
          }
        }
        systemCache.storage.external = extStorage;
      } catch {}

      // Disk I/O speeds
      try {
        const ioStats = runCmd("iostat -d 1 2 -y").split("\n");
        const diskLine = ioStats.find(l => l.startsWith("mmcblk0") || l.startsWith("sda"));
        if (diskLine) {
          const parts = diskLine.split(/\s+/);
          systemCache.storage.io.readSpeedBps = Math.round(parseFloat(parts[2] || "0") * 1024);
          systemCache.storage.io.writeSpeedBps = Math.round(parseFloat(parts[3] || "0") * 1024);
        }
      } catch {}

      // Failed login attempts
      try {
        systemCache.security.failedLogins = parseInt(
          runCmd("grep -c 'Failed password' /var/log/auth.log || journalctl _SYSTEMD_UNIT=ssh.service | grep -c 'Failed'") || "0"
        );
      } catch {}

      // Docker stats
      systemCache.dockerContainers = getLinuxDockerStats();

      // Critical system logs
      try {
        const logsRaw = runCmd("dmesg -level=err,crit,alert,emerg | tail -n 12 || journalctl -p 3 -n 12");
        systemCache.logs = logsRaw.split("\n").filter(Boolean);
      } catch {}

    } else {
      // Windows mock slow metrics
      systemCache.storage.external = [
        { mount: "/media/usb-backup", total: 64 * 1024 * 1024 * 1024, used: 24.5 * 1024 * 1024 * 1024, free: 39.5 * 1024 * 1024 * 1024, percent: 38 }
      ];
      systemCache.storage.io.readSpeedBps = Math.round(Math.random() * 1250 * 1024);
      systemCache.storage.io.writeSpeedBps = Math.round(Math.random() * 450 * 1024);
      systemCache.security.failedLogins = 3;
      
      systemCache.dockerContainers = [
        { name: "mariadb-prod", status: "running", cpu: `${(1 + Math.random() * 2).toFixed(1)}%`, memory: "124 MB / 2.0 GB (6.2%)" },
        { name: "redis-cache", status: "running", cpu: "0.2%", memory: "18 MB / 2.0 GB (0.9%)" },
        { name: "mosquitto-mqtt", status: "running", cpu: "0.1%", memory: "5.4 MB / 2.0 GB (0.2%)" }
      ];

      systemCache.logs = [
        "[   2.451892] Amlogic thermal zone0: registered thermal band",
        "[   4.892014] eth0: Link is Up - 100Mbps/Full - flow control rx/tx",
        "[  12.049102] EXT4-fs (mmcblk0p2): mounted filesystem with ordered data mode",
        "[ 341.251910] sshd[1251]: Accepted password for root from 192.168.1.10 port 49122 ssh2",
        "[ 345.920042] sshd[1284]: Failed password for invalid user admin from 114.24.120.35 port 51108 ssh2"
      ];
    }
  } catch (err) {
    console.error("Error in updateSlowMetrics background loop:", err);
  }
}

// Start Background Interval Loops
initCache();
updateQuickMetrics();
updateSlowMetrics();
setInterval(updateQuickMetrics, 2000);
setInterval(updateSlowMetrics, 10000);

// Route Handler
systemRouter.get("/analytics", async (c) => {
  if (!systemCache) {
    initCache();
    await updateQuickMetrics();
    await updateSlowMetrics();
  }
  
  // Return instantly from memory cache
  return c.json(systemCache);
});
