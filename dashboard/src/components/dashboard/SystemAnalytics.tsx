import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Cpu,
  HardDrive,
  Network,
  Shield,
  Activity,
  Thermometer,
  Clock,
  RefreshCw,
  Terminal,
  Users,
  UserX,
  AlertTriangle,
  Server,
  ArrowDown,
  ArrowUp,
  Radio,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { fetchApi } from "@/lib/api";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  YAxis,
  XAxis,
} from "recharts";

interface SystemAnalyticsData {
  device: {
    board: string;
    os: string;
    kernel: string;
    uptime: number;
    bootTime: string;
    localIp: string;
    pingLatencyMs: number;
  };
  cpu: {
    overallUsage: number;
    cores: number[];
    tempC: number;
    frequencyMhz: number;
    throttling: boolean;
    loadAverage: number[];
  };
  memory: {
    ram: {
      total: number;
      used: number;
      free: number;
      buffers: number;
      cached: number;
    };
    swap: {
      total: number;
      used: number;
      free: number;
    };
  };
  storage: {
    internal: {
      total: number;
      used: number;
      free: number;
      percent: number;
      health: string;
    };
    external: {
      mount: string;
      total: number;
      used: number;
      free: number;
      percent: number;
    }[];
    io: {
      readSpeedBps: number;
      writeSpeedBps: number;
    };
  };
  network: {
    throughput: {
      downloadBps: number;
      uploadBps: number;
    };
    traffic: {
      downloadBytes: number;
      uploadBytes: number;
    };
  };
  services: {
    name: string;
    active: boolean;
    label: string;
  }[];
  security: {
    sshSessions: number;
    failedLogins: number;
  };
  topProcesses: {
    cpu: number;
    ram: number;
    name: string;
  }[];
  logs: string[];
}

export default function SystemAnalytics() {
  const [data, setData] = useState<SystemAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cpuHistory, setCpuHistory] = useState<{ value: number }[]>([]);
  const [ramHistory, setRamHistory] = useState<{ value: number }[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      setRefreshing(true);
      const res = await fetchApi<SystemAnalyticsData>("/api/system/analytics");
      setData(res);
      
      // Keep cpu history rolling (max 20 data points)
      setCpuHistory((prev) => {
        const next = [...prev, { value: res.cpu.overallUsage }];
        return next.slice(-20);
      });

      // Keep ram history rolling (max 20 data points)
      const ramPercent = Math.round((res.memory.ram.used / res.memory.ram.total) * 100);
      setRamHistory((prev) => {
        const next = [...prev, { value: ramPercent }];
        return next.slice(-20);
      });
      
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch system analytics:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 2500);
    return () => clearInterval(interval);
  }, []);

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  const formatSpeed = (bps: number) => {
    const kbps = bps * 8; // convert bytes to bits
    if (kbps < 1000) return `${kbps.toFixed(0)} bps`;
    const mbps = kbps / 1000 / 1000;
    if (mbps < 1) return `${(kbps / 1000).toFixed(0)} Kbps`;
    return `${mbps.toFixed(1)} Mbps`;
  };

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(" ");
  };

  if (loading || !data) {
    return (
      <Card className="border-[var(--border)] bg-[var(--card)]/50 backdrop-blur-md">
        <CardContent className="h-48 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 text-[var(--primary)] animate-spin" />
          <p className="text-sm text-[var(--muted-foreground)]">Loading Internal Analytics...</p>
        </CardContent>
      </Card>
    );
  }

  // Determine temperature warning status
  const temp = data.cpu.tempC;
  const tempColor = temp > 75 ? "text-[var(--error)] animate-pulse" : temp > 60 ? "text-[var(--warning)]" : "text-[var(--success)]";

  return (
    <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md overflow-hidden shadow-lg transition-all duration-300 hover:shadow-xl">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 border-b border-[var(--border)] bg-[var(--card)]/80 gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
            <Server className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
              Internal System Analytics
              <span className="text-xs font-normal px-2 py-0.5 rounded bg-[var(--secondary)] text-[var(--muted-foreground)] border border-[var(--border)]">
                {data.device.board}
              </span>
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)] mt-0.5">
              <span>{data.device.os}</span>
              <span className="text-[var(--border)]">•</span>
              <span>Kernel {data.device.kernel}</span>
              <span className="text-[var(--border)]">•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                Uptime: {formatUptime(data.device.uptime)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono bg-[var(--secondary)]/50 px-3 py-1.5 rounded-md border border-[var(--border)]">
          <div className="flex items-center gap-2">
            <span className="text-[var(--muted-foreground)]">Local IP:</span>
            <span className="text-[var(--foreground)] font-semibold">{data.device.localIp}</span>
          </div>
          <span className="text-[var(--border)]">|</span>
          <div className="flex items-center gap-2">
            <span className="text-[var(--muted-foreground)]">Ping:</span>
            {data.device.pingLatencyMs > 0 ? (
              <span className={`font-semibold ${data.device.pingLatencyMs < 100 ? "text-[var(--success)]" : data.device.pingLatencyMs < 300 ? "text-[var(--warning)]" : "text-[var(--error)]"}`}>
                {data.device.pingLatencyMs}ms
              </span>
            ) : (
              <span className="text-[var(--error)] font-semibold">Offline</span>
            )}
          </div>
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
            <span className={`relative inline-flex rounded-full h-2 w-2 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
          </span>
        </div>
      </div>

      <CardContent className="p-6 space-y-6">
        {/* Core Resource Metrics (CPU, Memory, Storage) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* CPU Card */}
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 space-y-4 flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <span className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider">CPU Utilization</span>
                <h3 className="text-3xl font-bold text-[var(--foreground)]">{data.cpu.overallUsage}%</h3>
              </div>
              <div className="p-2 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
                <Cpu className="w-5 h-5" />
              </div>
            </div>

            {/* Sparkline AreaChart */}
            <div className="h-14 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={cpuHistory}>
                  <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <YAxis domain={[0, 100]} hide />
                  <XAxis hide />
                  <Area type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={1.5} fillOpacity={1} fill="url(#colorCpu)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Freq and Temp Info */}
            <div className="grid grid-cols-2 gap-2 text-xs border-t border-[var(--border)]/60 pt-3">
              <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                <Thermometer className={`w-4 h-4 ${tempColor}`} />
                <span>Temp:</span>
                <span className={`font-semibold ${tempColor}`}>{temp.toFixed(1)}°C</span>
              </div>
              <div className="flex items-center gap-1.5 text-[var(--muted-foreground)] justify-end">
                <Activity className="w-4 h-4 text-[var(--primary)]" />
                <span>Clock:</span>
                <span className="text-[var(--foreground)] font-semibold">{(data.cpu.frequencyMhz / 1000).toFixed(2)} GHz</span>
              </div>
            </div>

            {/* Load average and Throttling */}
            <div className="flex items-center justify-between text-xxs text-[var(--muted-foreground)] border-t border-[var(--border)]/40 pt-2">
              <span>Load: {data.cpu.loadAverage.map(l => l.toFixed(2)).join(", ")}</span>
              {data.cpu.throttling && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--error)]/15 text-[var(--error)] animate-pulse">
                  <AlertTriangle className="w-3 h-3" /> Throttling
                </span>
              )}
            </div>
            
            {/* Core Breakdown */}
            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between text-xxs text-[var(--muted-foreground)]">
                <span>Core breakdown</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {data.cpu.cores.map((usage, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="h-6 w-full bg-[var(--secondary)] rounded-sm overflow-hidden flex items-end">
                      <div className="w-full bg-[var(--primary)] transition-all duration-300" style={{ height: `${usage}%` }}></div>
                    </div>
                    <div className="text-center text-[8px] font-mono text-[var(--muted-foreground)]">C{idx}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Memory (RAM) Card */}
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 space-y-4 flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <span className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider">RAM Usage</span>
                <h3 className="text-3xl font-bold text-[var(--foreground)]">
                  {Math.round((data.memory.ram.used / data.memory.ram.total) * 100)}%
                </h3>
              </div>
              <div className="p-2 rounded-lg bg-[var(--success)]/10 text-[var(--success)]">
                <Activity className="w-5 h-5" />
              </div>
            </div>

            {/* Sparkline AreaChart */}
            <div className="h-14 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={ramHistory}>
                  <defs>
                    <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--success)" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="var(--success)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <YAxis domain={[0, 100]} hide />
                  <XAxis hide />
                  <Area type="monotone" dataKey="value" stroke="var(--success)" strokeWidth={1.5} fillOpacity={1} fill="url(#colorRam)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Used/Total display */}
            <div className="text-xs text-[var(--muted-foreground)] space-y-1.5">
              <div className="flex justify-between">
                <span>Memory usage:</span>
                <span className="font-semibold text-[var(--foreground)]">
                  {formatBytes(data.memory.ram.used)} / {formatBytes(data.memory.ram.total)}
                </span>
              </div>
              <Progress value={(data.memory.ram.used / data.memory.ram.total) * 100} className="h-1 bg-[var(--border)]" />
            </div>

            {/* Buffer / Cache / Swap info */}
            <div className="grid grid-cols-2 gap-2 text-xxs border-t border-[var(--border)]/60 pt-3 text-[var(--muted-foreground)]">
              <div>Cache/Buffer: {formatBytes(data.memory.ram.cached + data.memory.ram.buffers)}</div>
              <div className="text-right">
                Swap: {data.memory.swap.total > 0 ? `${Math.round((data.memory.swap.used / data.memory.swap.total) * 100)}%` : "0%"}
              </div>
            </div>
          </div>

          {/* Storage Card */}
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 space-y-4 flex flex-col justify-between">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <span className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider">Internal Storage</span>
                <h3 className="text-3xl font-bold text-[var(--foreground)]">{data.storage.internal.percent}%</h3>
              </div>
              <div className="p-2 rounded-lg bg-[var(--warning)]/10 text-[var(--warning)]">
                <HardDrive className="w-5 h-5" />
              </div>
            </div>

            {/* Space Bar Display */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
                <span>eMMC Storage:</span>
                <span className="font-semibold text-[var(--foreground)]">
                  {formatBytes(data.storage.internal.used)} / {formatBytes(data.storage.internal.total)}
                </span>
              </div>
              <Progress value={data.storage.internal.percent} className="h-1.5 bg-[var(--border)]" />
            </div>

            {/* eMMC health indicator */}
            <div className="text-xxs text-[var(--muted-foreground)] border-t border-[var(--border)]/60 pt-3 flex items-center justify-between">
              <span>Health:</span>
              <span className="font-semibold text-[var(--foreground)] truncate max-w-[170px]" title={data.storage.internal.health}>
                {data.storage.internal.health}
              </span>
            </div>

            {/* Real-time Disk I/O Activity */}
            <div className="grid grid-cols-2 gap-1 text-[10px] font-mono border-t border-[var(--border)]/40 pt-2 text-[var(--muted-foreground)]">
              <div className="flex items-center gap-1">
                <ArrowDown className="w-3.5 h-3.5 text-[var(--success)]" /> Read: {formatBytes(data.storage.io.readSpeedBps)}/s
              </div>
              <div className="flex items-center gap-1 justify-end">
                <ArrowUp className="w-3.5 h-3.5 text-[var(--primary)]" /> Write: {formatBytes(data.storage.io.writeSpeedBps)}/s
              </div>
            </div>
          </div>
        </div>

        {/* Network & Connective Details + External Storage */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Network Details */}
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 space-y-4 md:col-span-2">
            <span className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider block">Network & Data Traffic</span>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-1">
              {/* Throughput speeds */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <Radio className="w-4 h-4 text-[var(--primary)] animate-pulse" />
                  <span>Real-time Speed</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[var(--card)]/50 rounded-lg border border-[var(--border)]">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                      <ArrowDown className="w-4 h-4 text-[var(--success)]" /> Download
                    </div>
                    <div className="text-base font-bold font-mono text-[var(--foreground)] mt-1">
                      {formatSpeed(data.network.throughput.downloadBps)}
                    </div>
                  </div>
                  <div className="p-3 bg-[var(--card)]/50 rounded-lg border border-[var(--border)]">
                    <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                      <ArrowUp className="w-4 h-4 text-[var(--primary)]" /> Upload
                    </div>
                    <div className="text-base font-bold font-mono text-[var(--foreground)] mt-1">
                      {formatSpeed(data.network.throughput.uploadBps)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Network Total Traffic Volume */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <Network className="w-4 h-4 text-[var(--success)]" />
                  <span>Network Traffic Volume (Since Boot)</span>
                </div>
                <div className="p-3 bg-[var(--card)]/50 rounded-lg border border-[var(--border)] space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--muted-foreground)]">Received (Rx):</span>
                    <span className="font-semibold font-mono text-[var(--foreground)]">
                      {formatBytes(data.network.traffic.downloadBytes)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-[var(--border)]/40 pt-2">
                    <span className="text-[var(--muted-foreground)]">Transmitted (Tx):</span>
                    <span className="font-semibold font-mono text-[var(--foreground)]">
                      {formatBytes(data.network.traffic.uploadBytes)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* External Storage list */}
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 space-y-3 flex flex-col justify-between">
            <div>
              <span className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider block mb-3">External Storage</span>
              {data.storage.external.length === 0 ? (
                <div className="text-xs text-[var(--muted-foreground)] flex items-center justify-center h-20 border border-dashed border-[var(--border)] rounded-lg">
                  No USB/MicroSD storage mounted
                </div>
              ) : (
                <div className="space-y-2">
                  {data.storage.external.map((ext, idx) => (
                    <div key={idx} className="p-2.5 bg-[var(--card)]/50 rounded-lg border border-[var(--border)] text-xs space-y-1">
                      <div className="flex justify-between font-mono font-semibold truncate text-[var(--foreground)]">
                        <span>{ext.mount}</span>
                        <span>{ext.percent}%</span>
                      </div>
                      <Progress value={ext.percent} className="h-1 bg-[var(--border)]" />
                      <div className="flex justify-between text-[10px] text-[var(--muted-foreground)] pt-0.5">
                        <span>Free: {formatBytes(ext.free)}</span>
                        <span>Total: {formatBytes(ext.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="text-[9px] text-[var(--muted-foreground)] font-mono text-center pt-2">
              Akari AX512 Armbian Storage Mount Handler
            </div>
          </div>
        </div>

        {/* Third Section: Security, Services & Tasks */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Services list */}
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 space-y-3">
            <span className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider block">Service Management</span>
            <div className="space-y-2">
              {data.services.map((s, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-lg bg-[var(--card)]/50 border border-[var(--border)]">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${s.active ? "bg-[var(--success)]" : "bg-[var(--muted)]"}`}></span>
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${s.active ? "bg-[var(--success)]" : "bg-[var(--muted)]"}`}></span>
                    </span>
                    <span className="text-xs font-semibold text-[var(--foreground)]">{s.name}</span>
                  </div>
                  <span className="text-xxs text-[var(--muted-foreground)]">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top 5 processes */}
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 space-y-3">
            <span className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider block">Top resource consumers</span>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--card)]/50 overflow-hidden text-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--secondary)]/60 text-[var(--muted-foreground)] border-b border-[var(--border)] text-xxs font-semibold uppercase tracking-wider">
                    <th className="p-2">Process</th>
                    <th className="p-2 text-right">CPU</th>
                    <th className="p-2 text-right">RAM</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProcesses.map((p, idx) => (
                    <tr key={idx} className="border-b border-[var(--border)]/40 last:border-b-0 hover:bg-[var(--secondary)]/30">
                      <td className="p-2 font-mono font-medium text-[var(--foreground)] truncate max-w-[120px]">{p.name}</td>
                      <td className="p-2 text-right font-mono text-[var(--success)]">{p.cpu}%</td>
                      <td className="p-2 text-right font-mono text-[var(--primary)]">{p.ram}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Security details */}
          <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 space-y-4 flex flex-col justify-between">
            <div>
              <span className="text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider block mb-3">Security & Access Logs</span>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 bg-[var(--card)]/50 rounded-lg border border-[var(--border)] text-center space-y-1">
                  <Users className="w-5 h-5 mx-auto text-[var(--primary)]" />
                  <div className="text-xxs text-[var(--muted-foreground)]">SSH Sessions</div>
                  <div className="text-lg font-bold text-[var(--foreground)] font-mono">{data.security.sshSessions}</div>
                </div>
                <div className="p-3 bg-[var(--card)]/50 rounded-lg border border-[var(--border)] text-center space-y-1">
                  <UserX className="w-5 h-5 mx-auto text-[var(--error)]" />
                  <div className="text-xxs text-[var(--muted-foreground)]">Failed Logins</div>
                  <div className="text-lg font-bold text-[var(--foreground)] font-mono">{data.security.failedLogins}</div>
                </div>
              </div>
            </div>

            {data.security.failedLogins > 0 && (
              <div className="flex items-center gap-2 p-2 bg-[var(--warning)]/10 text-[var(--warning)] border border-[var(--warning)]/20 rounded-md text-xxs">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Security Notice: Detected unauthorized login attempts.</span>
              </div>
            )}
          </div>
        </div>

        {/* Collapsible logs console */}
        <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--secondary)]/10">
          <button
            onClick={() => setLogsExpanded(!logsExpanded)}
            className="w-full flex items-center justify-between p-4 bg-[var(--secondary)]/30 hover:bg-[var(--secondary)]/50 transition-all text-xs font-semibold text-[var(--foreground)] focus:outline-none"
          >
            <span className="flex items-center gap-2 font-mono">
              <Terminal className="w-4 h-4 text-[var(--primary)]" />
              SYSTEM CRITICAL LOG SUMMARY
            </span>
            <span className="text-[var(--muted-foreground)] flex items-center gap-1 text-xxs font-normal">
              {logsExpanded ? "Collapse Logs" : "Expand Logs"}
              {logsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>
          
          {logsExpanded && (
            <div className="p-4 bg-black/90 font-mono text-xxs text-[var(--success)] overflow-x-auto space-y-1 border-t border-[var(--border)] min-h-[100px] leading-relaxed">
              {data.logs.length === 0 ? (
                <div className="text-[var(--muted-foreground)] italic text-center py-4">No critical logs reported</div>
              ) : (
                data.logs.map((log, idx) => (
                  <div key={idx} className="whitespace-pre truncate border-b border-white/5 pb-1">
                    {log}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  );
}
