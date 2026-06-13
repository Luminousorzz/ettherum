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

// Helper to execute commands and return trimmed stdout
function runCmd(cmd: string): string {
  try {
    return execSync(cmd, { stdio: "pipe", timeout: 2000 }).toString().trim();
  } catch {
    return "";
  }
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

    // Per-core CPU (cpu0, cpu1, cpu2, cpu3)
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
      // Look for eth0, wlan0, end0, enp, or enx
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

systemRouter.get("/analytics", async (c) => {
  const isLinux = process.platform === "linux";

  // System general info
  const osType = isLinux ? "Linux (Armbian)" : "Windows (Dev Mode)";
  const boardName = isLinux ? (runCmd("cat /sys/firmware/devicetree/base/model") || "Akari AX512 STB") : "Akari AX512 (Dev Board)";
  const kernelVersion = os.release();
  const uptime = os.uptime();
  const bootTime = new Date(Date.now() - uptime * 1000).toISOString();

  // Network local IP and external ping
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

  // Perform a fast async ping/latency check
  let pingLatency = 0;
  try {
    const startPing = Date.now();
    if (isLinux) {
      runCmd("ping -c 1 -W 1 8.8.8.8");
    } else {
      runCmd("ping -n 1 -w 1000 8.8.8.8");
    }
    pingLatency = Date.now() - startPing;
  } catch {
    pingLatency = -1; // Failed ping
  }

  // GATHER OS METRICS
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
  let ioReadSpeed = 0; // Bytes/sec
  let ioWriteSpeed = 0; // Bytes/sec
  let sshSessions = 0;
  let failedLogins = 0;
  let topProcesses: any[] = [];
  let criticalLogs: string[] = [];

  // Services list
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
        cpuFreq = Math.round(rawFreq / 1000); // Convert kHz to MHz
      }
    } catch {}

    isThrottled = cpuTemp > 78; // Throttling threshold
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
        storageHealth = "eMMC Normal (sysfs lifetime healthy)";
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
        ioReadSpeed = Math.round(parseFloat(parts[2] || "0") * 1024); // Convert kB/s to B/s
        ioWriteSpeed = Math.round(parseFloat(parts[3] || "0") * 1024);
      }
    } catch {}

    // 4. Linux Network update
    updateLinuxNetwork();

    // 5. Linux SSH sessions
    try {
      sshSessions = runCmd("who | grep -c pts").split("\n").length;
    } catch {}

    // Failed login attempts
    try {
      failedLogins = parseInt(runCmd("grep -c 'Failed password' /var/log/auth.log || journalctl _SYSTEMD_UNIT=ssh.service | grep -c 'Failed'") || "0");
    } catch {}

    // 6. Top Processes
    try {
      const topRows = runCmd("ps -eo pcpu,pmem,comm --sort=-pcpu | head -n 6").split("\n").slice(1);
      topProcesses = topRows.map(row => {
        const parts = row.trim().split(/\s+/);
        return {
          cpu: parseFloat(parts[0] || "0"),
          ram: parseFloat(parts[1] || "0"),
          name: parts.slice(2).join(" ")
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

    // 8. Critical logs
    try {
      criticalLogs = runCmd("dmesg -level=err,crit,alert,emerg | tail -n 5 || journalctl -p 3 -n 5").split("\n").filter(Boolean);
    } catch {}

  } else {
    // ----------------------------------------------------
    // WINDOWS / DEVELOPMENT MOCK METRICS
    // Simulate real-time metrics for Akari AX512 Armbian
    // ----------------------------------------------------
    const randomVal = Math.random();
    cpuUsage = Math.round(15 + randomVal * 30); // 15% - 45% CPU
    cpuCores = [
      Math.round(10 + Math.random() * 20),
      Math.round(25 + Math.random() * 30),
      Math.round(5 + Math.random() * 15),
      Math.round(15 + Math.random() * 25)
    ];
    cpuTemp = Math.round(48 + randomVal * 12); // 48C - 60C
    cpuFreq = 1512; // 1.5 GHz clock speed
    isThrottled = false;
    loadAvg = [parseFloat((0.3 + randomVal * 0.4).toFixed(2)), parseFloat((0.25 + randomVal * 0.3).toFixed(2)), 0.18];

    // 2GB RAM device simulation
    ramTotal = 2 * 1024 * 1024 * 1024;
    ramUsed = Math.round(ramTotal * (0.42 + randomVal * 0.1));
    ramFree = ramTotal - ramUsed;
    ramBuffers = 124 * 1024 * 1024;
    ramCached = 432 * 1024 * 1024;

    swapTotal = 512 * 1024 * 1024;
    swapUsed = Math.round(swapTotal * 0.12);
    swapFree = swapTotal - swapUsed;

    // 16GB eMMC simulation
    storageTotal = 14.5 * 1024 * 1024 * 1024;
    storageUsed = 6.2 * 1024 * 1024 * 1024;
    storageFree = storageTotal - storageUsed;
    storagePercent = Math.round((storageUsed / storageTotal) * 100);
    storageHealth = "eMMC Normal (0x01: Healthy life span estimated 90% remaining)";

    extStorage = [
      { mount: "/media/usb-storage", total: 64 * 1024 * 1024 * 1024, used: 24.5 * 1024 * 1024 * 1024, free: 39.5 * 1024 * 1024 * 1024, percent: 38 }
    ];

    // Simulated network throughput
    netThroughput = {
      rx: Math.round(150 * 1024 + Math.random() * 850 * 1024), // 150 KB/s - 1 MB/s
      tx: Math.round(20 * 1024 + Math.random() * 180 * 1024)
    };
    totalRx = 14.2 * 1024 * 1024 * 1024; // 14.2 GB
    totalTx = 2.1 * 1024 * 1024 * 1024;

    ioReadSpeed = Math.round(Math.random() * 250 * 1024);
    ioWriteSpeed = Math.round(Math.random() * 450 * 1024);

    sshSessions = 1;
    failedLogins = 3;

    topProcesses = [
      { cpu: 12.4, ram: 4.8, name: "etteum-agent" },
      { cpu: 4.2, ram: 1.2, name: "nginx" },
      { cpu: 2.1, ram: 6.5, name: "dockerd" },
      { cpu: 1.5, ram: 0.8, name: "sshd" },
      { cpu: 0.8, ram: 2.4, name: "systemd" }
    ];

    services = [
      { name: "nginx", active: true, label: "Web Server" },
      { name: "docker", active: true, label: "Docker Daemon" },
      { name: "ssh", active: true, label: "SSH Remote Daemon" },
      { name: "etteum", active: true, label: "Pool Proxy Backend" }
    ];

    criticalLogs = [
      "[   2.451892] Amlogic thermal zone0: registered thermal band",
      "[   4.892014] eth0: Link is Up - 100Mbps/Full - flow control rx/tx",
      "[  12.049102] EXT4-fs (mmcblk0p2): mounted filesystem with ordered data mode"
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
      pingLatencyMs: pingLatency
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
    security: {
      sshSessions,
      failedLogins
    },
    topProcesses,
    logs: criticalLogs
  });
});
