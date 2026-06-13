import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Network, ArrowDown, ArrowUp, RefreshCw, AlertTriangle, Activity } from "lucide-react";
import { fetchApi } from "@/lib/api";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  YAxis,
  XAxis,
  Tooltip,
  LineChart,
  Line,
  CartesianGrid,
  Legend
} from "recharts";

export default function NetworkConnection() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [netHistory, setNetHistory] = useState<any[]>([]);
  const [pingHistory, setPingHistory] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      setRefreshing(true);
      const res = await fetchApi<any>("/api/system/analytics");
      setData(res);

      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      setNetHistory((prev) => {
        const next = [...prev, {
          time: timestamp,
          downloadKbps: Math.round((res.network.throughput.downloadBps * 8) / 1000),
          uploadKbps: Math.round((res.network.throughput.uploadBps * 8) / 1000)
        }];
        return next.slice(-25);
      });

      setPingHistory((prev) => {
        const next = [...prev, { time: timestamp, latency: res.device.pingLatencyMs }];
        return next.slice(-25);
      });
      
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch Network stats:", err);
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

  const formatSpeedStr = (bps: number) => {
    const kbps = bps * 8;
    if (kbps < 1000) return `${kbps.toFixed(0)} bps`;
    const mbps = kbps / 1000 / 1000;
    if (mbps < 1) return `${(kbps / 1000).toFixed(0)} Kbps`;
    return `${mbps.toFixed(1)} Mbps`;
  };

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-[var(--primary)] animate-spin" />
        <span className="text-sm text-[var(--muted-foreground)]">Loading Network Connection...</span>
      </div>
    );
  }

  const loss = data.device.pingPacketLoss;
  const isLossWarning = loss > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Network & Connection</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Real-time internet connection speed, local & public IP, ping latency, and packet loss
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] font-mono">
          <span>OS: {data.device.os}</span>
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
          </span>
        </div>
      </div>

      {/* Grid: IP Configuration & Ping/Latency */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* IP details card */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
              <Globe className="w-4 h-4 text-[var(--primary)]" />
              IP Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div className="p-3 bg-[var(--secondary)]/30 rounded-lg border border-[var(--border)] flex justify-between items-center">
              <div>
                <div className="text-[10px] text-[var(--muted-foreground)]">Local IP Address</div>
                <div className="font-mono font-bold text-[var(--foreground)] mt-0.5">{data.device.localIp}</div>
              </div>
              <span className="text-xxs font-mono px-2 py-0.5 rounded bg-[var(--secondary)] text-[var(--muted-foreground)] border border-[var(--border)]">LAN</span>
            </div>

            <div className="p-3 bg-[var(--secondary)]/30 rounded-lg border border-[var(--border)] flex justify-between items-center">
              <div>
                <div className="text-[10px] text-[var(--muted-foreground)]">Public IP Address</div>
                <div className="font-mono font-bold text-[var(--foreground)] mt-0.5">{data.device.publicIp}</div>
              </div>
              <span className="text-xxs font-mono px-2 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] border border-[var(--primary)]/20">WAN</span>
            </div>
          </CardContent>
        </Card>

        {/* Real-time throughput speedometers */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Throughput Speed
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-[var(--secondary)]/30 rounded-xl border border-[var(--border)] flex flex-col justify-between h-28">
              <span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                <ArrowDown className="w-4 h-4 text-[var(--success)]" /> Download
              </span>
              <div className="text-xl font-bold font-mono text-[var(--foreground)]">
                {formatSpeedStr(data.network.throughput.downloadBps)}
              </div>
              <span className="text-[9px] text-[var(--muted-foreground)] font-mono">Receiving speed</span>
            </div>

            <div className="p-4 bg-[var(--secondary)]/30 rounded-xl border border-[var(--border)] flex flex-col justify-between h-28">
              <span className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                <ArrowUp className="w-4 h-4 text-[var(--primary)]" /> Upload
              </span>
              <div className="text-xl font-bold font-mono text-[var(--foreground)]">
                {formatSpeedStr(data.network.throughput.uploadBps)}
              </div>
              <span className="text-[9px] text-[var(--muted-foreground)] font-mono">Sending speed</span>
            </div>
          </CardContent>
        </Card>

        {/* Latency & Packet Loss Card */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--success)]" />
              Ping & Packet Loss
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-[var(--secondary)]/30 rounded-lg border border-[var(--border)] text-center space-y-1">
              <div className="text-xxs text-[var(--muted-foreground)]">Ping (8.8.8.8)</div>
              <div className="text-lg font-bold font-mono text-[var(--foreground)]">
                {data.device.pingLatencyMs > 0 ? `${data.device.pingLatencyMs} ms` : "Offline"}
              </div>
            </div>
            <div className={`p-3 rounded-lg border text-center space-y-1 ${isLossWarning ? "bg-[var(--error)]/10 border-[var(--error)]/25 text-[var(--error)]" : "bg-[var(--secondary)]/30 border-[var(--border)] text-[var(--foreground)]"}`}>
              <div className="text-xxs text-[var(--muted-foreground)]">Packet Loss</div>
              <div className="text-lg font-bold font-mono">
                {loss}%
              </div>
            </div>
            {isLossWarning && (
              <div className="col-span-2 flex items-center gap-1.5 px-2.5 py-1 bg-[var(--error)]/10 text-[var(--error)] border border-[var(--error)]/20 rounded text-[10px] font-semibold animate-pulse">
                <AlertTriangle className="w-3.5 h-3.5" /> High Packet Loss detected!
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Grid: Throughput history & Ping history charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Network speed history */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Bandwidth Throughput History (Kbps)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={netHistory}>
                <defs>
                  <linearGradient id="dlSpeed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--success)" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="var(--success)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="ulSpeed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" className="opacity-30" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={9} className="font-mono" />
                <YAxis stroke="var(--muted-foreground)" fontSize={9} />
                <Tooltip contentStyle={{ background: "var(--card)", borderColor: "var(--border)" }} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Area type="monotone" name="Download (Kbps)" dataKey="downloadKbps" stroke="var(--success)" strokeWidth={1.5} fillOpacity={1} fill="url(#dlSpeed)" />
                <Area type="monotone" name="Upload (Kbps)" dataKey="uploadKbps" stroke="var(--primary)" strokeWidth={1.5} fillOpacity={1} fill="url(#ulSpeed)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Latency History */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Ping Latency Trend (ms)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pingHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" className="opacity-30" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={9} className="font-mono" />
                <YAxis stroke="var(--muted-foreground)" fontSize={9} />
                <Tooltip contentStyle={{ background: "var(--card)", borderColor: "var(--border)" }} />
                <Line type="monotone" name="Latency (ms)" dataKey="latency" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Network Traffic Volume */}
      <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
            <Network className="w-4 h-4 text-[var(--primary)]" />
            Total Data Traffic Volume (Since Boot)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xxs text-[var(--muted-foreground)] uppercase font-semibold">Total Received (Rx)</span>
              <h4 className="text-2xl font-bold font-mono text-[var(--foreground)]">{formatBytes(data.network.traffic.downloadBytes)}</h4>
            </div>
            <div className="p-3 bg-[var(--success)]/10 text-[var(--success)] rounded-lg">
              <ArrowDown className="w-6 h-6" />
            </div>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xxs text-[var(--muted-foreground)] uppercase font-semibold">Total Transmitted (Tx)</span>
              <h4 className="text-2xl font-bold font-mono text-[var(--foreground)]">{formatBytes(data.network.traffic.uploadBytes)}</h4>
            </div>
            <div className="p-3 bg-[var(--primary)]/10 text-[var(--primary)] rounded-lg">
              <ArrowUp className="w-6 h-6" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
