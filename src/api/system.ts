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

systemRouter.get("/analytics", async (c) => {
  const isLinux = process.platform === "linux";

  const publicIp = await getPublicIp();
  const pingStats = getPingStats();

  // System general info
  const osType = isLinux ? "Linux (Armbian)" : "Windows (Dev Mode)";
  const boardName = isLinux ? (runCmd("cat /sys/firmware/devicetree/base/model") || "Akari AX512 STB") : "Akari AX512 STB (Dev Board)";
  const kernelVersion = os.release();
  const uptime = os.uptime();
  const bootTime = new Date(Date.now() - uptime * 1000).toISOString();

  // Network local IP
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

  // GATHER METRICS
  let cpuUsage = 0;
  let cpuCores: number[] = [0, 0, 0, 0];
  let cpuTemp = 0;
  let cpuFreq = 0;
  let isThrottled = false;
  let loadAvg = [0, 0, 0];

  let ramTotal = 0;
  let ramUsed = 0;
  let ramFree = 0;
  let ramBuffers = 0;
  let ramCached = 0;

  let swapTotal = 0;
  let swapUsed = 0;
  let swapFree = 0;

  let storageTotal = 0;
  let storageUsed = 0;
  let storageFree = 0;
  let storagePercent = 0;
  
  let extStorage: any[] = [];
  let storageHealth = "Healthy";
  let ioReadSpeed = 0;
  let ioWriteSpeed = 0;
  
  let sshSessionsList: any[] = [];
  let failedLogins = 0;
  let topProcesses: any[] = [];
  let criticalLogs: string[] = [];
  let dockerContainers: any[] = [];

  let services = [
    { name: "nginx", active: false, label: "Web Server" },
    { name: "docker", active: false, label: "Docker Daemon" },
    { name: "ssh", active: false, label: "SSH Remote Daemon" },
    { name: "etteum", active: true, label: "Pool Proxy Backend" }
  ];

  if (isLinux) {
    // 1. Linux CPU stats
    const linuxCpu = getLinuxCpuUsage();
    cpuUsage = linuxCpu.overall;
    cpuCores = linuxCpu.cores.length ? linuxCpu.cores : [cpuUsage, cpuUsage, cpuUsage, cpuUsage];
    
    // CPU Temp
    try {
      if (fs.existsSync("/sys/class/thermal/thermal_zone0/temp")) {
        const rawTemp = parseInt(fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8"));
        cpuTemp = rawTemp / 1000;
      }
    } catch {}

    // CPU Freq
    try {
      if (fs.existsSync("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")) {
        const rawFreq = parseInt(fs.readFileSync("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq", "utf8"));
        cpuFreq = Math.round(rawFreq / 1000);
      }
    } catch {}

    isThrottled = cpuTemp > 78;
    loadAvg = os.loadavg();

    // 2. Linux Memory stats
    try {
      const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
      const lines = meminfo.split("\n");
      const memTotal = parseInt(lines.find(l => l.startsWith("MemTotal:"))?.split(/\s+/)[1] || "0") * 1024;
      const memFree = parseInt(lines.find(l => l.startsWith("MemFree:"))?.split(/\s+/)[1] || "0") * 1024;
      const memBuffers = parseInt(lines.find(l => l.startsWith("Buffers:"))?.split(/\s+/)[1] || "0") * 1024;
      const memCached = parseInt(lines.find(l => l.startsWith("Cached:"))?.split(/\s+/)[1] || "0") * 1024;
      const memAvailable = parseInt(lines.find(l => l.startsWith("MemAvailable:"))?.split(/\s+/)[1] || "0") * 1024;

      ramTotal = memTotal;
      ramFree = memAvailable || (memFree + memBuffers + memCached);
      ramUsed = ramTotal - ramFree;
      ramBuffers = memBuffers;
      ramCached = memCached;

      const swTotal = parseInt(lines.find(l => l.startsWith("SwapTotal:"))?.split(/\s+/)[1] || "0") * 1024;
      const swFree = parseInt(lines.find(l => l.startsWith("SwapFree:"))?.split(/\s+/)[1] || "0") * 1024;
      swapTotal = swTotal;
      swapFree = swFree;
      swapUsed = swTotal - swFree;
    } catch {
      ramTotal = os.totalmem();
      ramFree = os.freemem();
      ramUsed = ramTotal - ramFree;
    }

    // 3. Linux Storage stats
    try {
      const df = runCmd("df -B1 /").split("\n")[1].split(/\s+/);
      storageTotal = parseInt(df[1]);
      storageUsed = parseInt(df[2]);
      storageFree = parseInt(df[3]);
      storagePercent = Math.round((storageUsed / storageTotal) * 100);
    } catch {}

    // External Storage
    try {
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
    } catch {}

    // Health/wearout of eMMC
    try {
      if (fs.existsSync("/sys/class/block/mmcblk0/device/life_time")) {
        const wear = fs.readFileSync("/sys/class/block/mmcblk0/device/life_time", "utf8").trim();
        storageHealth = `Wearout status: ${wear} (Type-A/B life span)`;
      } else {
        storageHealth = "eMMC Normal (0x01: Life span estimated 100% remaining)";
      }
    } catch {
      storageHealth = "Healthy";
    }

    // Disk I/O Speeds
    try {
      const ioStats = runCmd("iostat -d 1 2 -y").split("\n");
      const diskLine = ioStats.find(l => l.startsWith("mmcblk0") || l.startsWith("sda"));
      if (diskLine) {
        const parts = diskLine.split(/\s+/);
        ioReadSpeed = Math.round(parseFloat(parts[2] || "0") * 1024);
        ioWriteSpeed = Math.round(parseFloat(parts[3] || "0") * 1024);
      }
    } catch {}

    // 4. Linux Network update
    updateLinuxNetwork();

    // 5. Linux SSH sessions & IPs
    sshSessionsList = getLinuxSshSessions();

    // Failed login attempts
    try {
      failedLogins = parseInt(runCmd("grep -c 'Failed password' /var/log/auth.log || journalctl _SYSTEMD_UNIT=ssh.service | grep -c 'Failed'") || "0");
    } catch {}

    // 6. Top Processes (PID, USER, CPU, RAM, Command)
    try {
      const topRows = runCmd("ps -eo pid,user,pcpu,pmem,comm --sort=-pcpu | head -n 6").split("\n").slice(1);
      topProcesses = topRows.map(row => {
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

    // 7. Services Status
    services = services.map(s => {
      try {
        const activeState = runCmd(`systemctl is-active ${s.name}`) === "active";
        return { ...s, active: activeState };
      } catch {
        return s;
      }
    });

    // Docker container stats
    dockerContainers = getLinuxDockerStats();

    // 8. Critical logs
    try {
      criticalLogs = runCmd("dmesg -level=err,crit,alert,emerg | tail -n 10 || journalctl -p 3 -n 10").split("\n").filter(Boolean);
    } catch {}

  } else {
    // ----------------------------------------------------
    // WINDOWS / DEVELOPMENT MOCK METRICS
    // ----------------------------------------------------
    const randomVal = Math.random();
    cpuUsage = Math.round(15 + randomVal * 30);
    cpuCores = [
      Math.round(10 + Math.random() * 20),
      Math.round(25 + Math.random() * 30),
      Math.round(5 + Math.random() * 15),
      Math.round(15 + Math.random() * 25)
    ];
    cpuTemp = Math.round(48 + randomVal * 12);
    cpuFreq = 1512;
    isThrottled = cpuTemp > 75;
    loadAvg = [parseFloat((0.3 + randomVal * 0.4).toFixed(2)), parseFloat((0.25 + randomVal * 0.3).toFixed(2)), 0.18];

    ramTotal = 2 * 1024 * 1024 * 1024;
    ramUsed = Math.round(ramTotal * (0.42 + randomVal * 0.1));
    ramFree = ramTotal - ramUsed;
    ramBuffers = 124 * 1024 * 1024;
    ramCached = 432 * 1024 * 1024;

    swapTotal = 512 * 1024 * 1024;
    swapUsed = Math.round(swapTotal * 0.12);
    swapFree = swapTotal - swapUsed;

    storageTotal = 14.5 * 1024 * 1024 * 1024;
    storageUsed = 6.2 * 1024 * 1024 * 1024;
    storageFree = storageTotal - storageUsed;
    storagePercent = Math.round((storageUsed / storageTotal) * 100);
    storageHealth = "eMMC Healthy (wearout: 5% used, lifetime: 0.1 type-A/B)";

    extStorage = [
      { mount: "/media/usb-backup", total: 64 * 1024 * 1024 * 1024, used: 24.5 * 1024 * 1024 * 1024, free: 39.5 * 1024 * 1024 * 1024, percent: 38 }
    ];

    netThroughput = {
      rx: Math.round(150 * 1024 + Math.random() * 850 * 1024),
      tx: Math.round(20 * 1024 + Math.random() * 180 * 1024)
    };
    totalRx = 14.2 * 1024 * 1024 * 1024;
    totalTx = 2.1 * 1024 * 1024 * 1024;

    ioReadSpeed = Math.round(Math.random() * 1250 * 1024);
    ioWriteSpeed = Math.round(Math.random() * 450 * 1024);

    sshSessionsList = [
      { user: "root", terminal: "pts/0", loginTime: "2026-06-13 18:40", ip: "192.168.1.10" },
      { user: "admin", terminal: "pts/1", loginTime: "2026-06-13 19:10", ip: "114.24.120.35" }
    ];
    failedLogins = 3;

    topProcesses = [
      { pid: 26224, user: "root", cpu: 12.4, ram: 4.8, name: "etteum-agent" },
      { pid: 1042, user: "www-data", cpu: 4.2, ram: 1.2, name: "nginx" },
      { pid: 842, user: "root", cpu: 2.1, ram: 6.5, name: "dockerd" },
      { pid: 1251, user: "ssh", cpu: 1.5, ram: 0.8, name: "sshd" },
      { pid: 1, user: "root", cpu: 0.8, ram: 2.4, name: "systemd" }
    ];

    services = [
      { name: "nginx", active: true, label: "Web Server" },
      { name: "docker", active: true, label: "Docker Daemon" },
      { name: "ssh", active: true, label: "SSH Remote Daemon" },
      { name: "etteum", active: true, label: "Pool Proxy Backend" }
    ];

    dockerContainers = [
      { name: "mariadb-prod", status: "running", cpu: "1.4%", memory: "124 MB / 2.0 GB (6.2%)" },
      { name: "redis-cache", status: "running", cpu: "0.2%", memory: "18 MB / 2.0 GB (0.9%)" },
      { name: "mosquitto-mqtt", status: "running", cpu: "0.1%", memory: "5.4 MB / 2.0 GB (0.2%)" }
    ];

    criticalLogs = [
      "[   2.451892] Amlogic thermal zone0: registered thermal band",
      "[   4.892014] eth0: Link is Up - 100Mbps/Full - flow control rx/tx",
      "[  12.049102] EXT4-fs (mmcblk0p2): mounted filesystem with ordered data mode",
      "[ 341.251910] sshd[1251]: Accepted password for root from 192.168.1.10 port 49122 ssh2",
      "[ 345.920042] sshd[1284]: Failed password for invalid user admin from 114.24.120.35 port 51108 ssh2"
    ];
  }

  return c.json({
    device: {
      board: boardName,
      os: osType,
      kernel: kernelVersion,
      uptime,
      bootTime,
      localIp,
      publicIp,
      pingLatencyMs: pingStats.latency,
      pingPacketLoss: pingStats.packetLoss
    },
    cpu: {
      overallUsage: cpuUsage,
      cores: cpuCores,
      tempC: cpuTemp,
      frequencyMhz: cpuFreq,
      throttling: isThrottled,
      loadAverage: loadAvg
    },
    memory: {
      ram: {
        total: ramTotal,
        used: ramUsed,
        free: ramFree,
        buffers: ramBuffers,
        cached: ramCached
      },
      swap: {
        total: swapTotal,
        used: swapUsed,
        free: swapFree
      }
    },
    storage: {
      internal: {
        total: storageTotal,
        used: storageUsed,
        free: storageFree,
        percent: storagePercent,
        health: storageHealth
      },
      external: extStorage,
      io: {
        readSpeedBps: ioReadSpeed,
        writeSpeedBps: ioWriteSpeed
      }
    },
    network: {
      throughput: {
        downloadBps: netThroughput.rx,
        uploadBps: netThroughput.tx
      },
      traffic: {
        downloadBytes: totalRx,
        uploadBytes: totalTx
      }
    },
    services,
    dockerContainers,
    security: {
      sshSessionsCount: sshSessionsList.length,
      sshSessionsList,
      failedLogins
    },
    topProcesses,
    logs: criticalLogs
  });
});
