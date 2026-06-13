import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HardDrive, Activity, RefreshCw, AlertTriangle, ArrowDown, ArrowUp } from "lucide-react";
import { fetchApi } from "@/lib/api";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend
} from "recharts";

export default function MemoryStorage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      setRefreshing(true);
      const res = await fetchApi<any>("/api/system/analytics");
      setData(res);
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch Memory & Storage stats:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
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

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-[var(--primary)] animate-spin" />
        <span className="text-sm text-[var(--muted-foreground)]">Loading Memory & Storage...</span>
      </div>
    );
  }

  // RAM Pie Chart Data
  const ramChartData = [
    { name: "Used RAM", value: data.memory.ram.used, color: "var(--primary)" },
    { name: "Cache & Buffer", value: data.memory.ram.cached + data.memory.ram.buffers, color: "var(--success)" },
    { name: "Free RAM", value: data.memory.ram.free, color: "rgba(128, 128, 128, 0.15)" }
  ];

  // Internal storage Pie Chart Data
  const storageChartData = [
    { name: "Used eMMC", value: data.storage.internal.used, color: "var(--warning)" },
    { name: "Free eMMC", value: data.storage.internal.free, color: "rgba(128, 128, 128, 0.15)" }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Memory & Storage</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Analyze memory allocation, Swap usage, eMMC wearout, and external mount points
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] font-mono">
          <span>IP: {data.device.localIp}</span>
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
          </span>
        </div>
      </div>

      {/* Grid: Pie Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* RAM Donut Chart */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center justify-between">
              <span>RAM Allocation</span>
              <span className="text-xs text-[var(--primary)] font-mono">Total: {formatBytes(data.memory.ram.total, 1)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center p-6 space-y-4">
            <div className="h-48 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={ramChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {ramChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatBytes(Number(value))} contentStyle={{ background: "var(--card)", borderColor: "var(--border)" }} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full text-center text-xs text-[var(--muted-foreground)] grid grid-cols-3 gap-2 pt-2 border-t border-[var(--border)]/30">
              <div>
                <div className="font-semibold text-[var(--primary)]">{Math.round((data.memory.ram.used / data.memory.ram.total) * 100)}%</div>
                <div className="text-xxs">Used</div>
              </div>
              <div>
                <div className="font-semibold text-[var(--success)]">
                  {Math.round(((data.memory.ram.cached + data.memory.ram.buffers) / data.memory.ram.total) * 100)}%
                </div>
                <div className="text-xxs">Cache/Buff</div>
              </div>
              <div>
                <div className="font-semibold text-[var(--muted-foreground)]">{Math.round((data.memory.ram.free / data.memory.ram.total) * 100)}%</div>
                <div className="text-xxs">Free</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* eMMC Donut Chart */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center justify-between">
              <span>Internal eMMC Space</span>
              <span className="text-xs text-[var(--warning)] font-mono">Total: {formatBytes(data.storage.internal.total, 1)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center p-6 space-y-4">
            <div className="h-48 w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={storageChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {storageChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => formatBytes(Number(value))} contentStyle={{ background: "var(--card)", borderColor: "var(--border)" }} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-full text-center text-xs text-[var(--muted-foreground)] grid grid-cols-2 gap-2 pt-2 border-t border-[var(--border)]/30">
              <div>
                <div className="font-semibold text-[var(--warning)]">{data.storage.internal.percent}%</div>
                <div className="text-xxs">Used</div>
              </div>
              <div>
                <div className="font-semibold text-[var(--muted-foreground)]">{100 - data.storage.internal.percent}%</div>
                <div className="text-xxs">Free</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Disk I/O & Memory Swap info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Swap Usage */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Virtual Memory (Swap)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.memory.swap.total > 0 ? (
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--muted-foreground)]">Swap Used:</span>
                  <span className="font-mono font-semibold text-[var(--foreground)]">
                    {formatBytes(data.memory.swap.used)} / {formatBytes(data.memory.swap.total)}
                  </span>
                </div>
                <Progress value={(data.memory.swap.used / data.memory.swap.total) * 100} className="h-2 bg-[var(--secondary)]" />
                <div className="text-xxs text-[var(--muted-foreground)] text-right">
                  {Math.round((data.memory.swap.used / data.memory.swap.total) * 100)}% utilization
                </div>
              </div>
            ) : (
              <div className="text-xs text-[var(--muted-foreground)] flex items-center justify-center h-16 border border-dashed border-[var(--border)] rounded-lg">
                No Swap space configured
              </div>
            )}
          </CardContent>
        </Card>

        {/* Disk I/O speeds */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Disk I/O Speeds
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-xs">
            <div className="flex items-center justify-between p-3 bg-[var(--secondary)]/30 rounded-lg border border-[var(--border)]">
              <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                <ArrowDown className="w-4 h-4 text-[var(--success)]" /> Write Activity
              </span>
              <span className="font-bold text-[var(--foreground)]">{formatBytes(data.storage.io.writeSpeedBps)}/s</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-[var(--secondary)]/30 rounded-lg border border-[var(--border)]">
              <span className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                <ArrowUp className="w-4 h-4 text-[var(--primary)]" /> Read Activity
              </span>
              <span className="font-bold text-[var(--foreground)]">{formatBytes(data.storage.io.readSpeedBps)}/s</span>
            </div>
          </CardContent>
        </Card>

        {/* Storage health */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--warning)]" />
              eMMC Lifetime Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="p-3 bg-[var(--secondary)]/30 rounded-lg border border-[var(--border)]">
              <div className="text-xxs text-[var(--muted-foreground)]">eMMC Wearout / Smart Status</div>
              <div className="font-semibold text-[var(--foreground)] mt-1">{data.storage.internal.health}</div>
            </div>
            <div className="flex items-start gap-2 text-xxs text-[var(--muted-foreground)]">
              <AlertTriangle className="w-3.5 h-3.5 text-[var(--primary)] shrink-0" />
              <span>STB devices like Akari AX512 have eMMC cells which degrade over time. Watch for values &gt; 90% wearout to avoid system failure.</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* External Storage Mounts */}
      <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[var(--primary)]" />
            Mounted External Storages (MicroSD / USB SSD)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.storage.external.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] flex items-center justify-center h-24 border border-dashed border-[var(--border)] rounded-xl">
              No MicroSD card or USB storage device mounted
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.storage.external.map((ext: any, idx: number) => (
                <div key={idx} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 space-y-2.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-mono font-bold text-[var(--foreground)] truncate max-w-[200px]" title={ext.mount}>
                      {ext.mount}
                    </span>
                    <span className="font-bold text-[var(--primary)]">{ext.percent}% Used</span>
                  </div>
                  <Progress value={ext.percent} className="h-1.5 bg-[var(--secondary)]" />
                  <div className="flex justify-between text-xxs text-[var(--muted-foreground)] font-mono">
                    <span>Used: {formatBytes(ext.used)}</span>
                    <span>Free: {formatBytes(ext.free)}</span>
                    <span>Total: {formatBytes(ext.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
