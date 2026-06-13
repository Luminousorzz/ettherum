import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Cpu, Thermometer, Activity, Clock, RefreshCw, AlertTriangle } from "lucide-react";
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

export default function CpuPerformance() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cpuHistory, setCpuHistory] = useState<any[]>([]);
  const [loadHistory, setLoadHistory] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      setRefreshing(true);
      const res = await fetchApi<any>("/api/system/analytics");
      setData(res);

      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      setCpuHistory((prev) => {
        const next = [...prev, { time: timestamp, usage: res.cpu.overallUsage, temp: res.cpu.tempC }];
        return next.slice(-25);
      });

      setLoadHistory((prev) => {
        const next = [...prev, {
          time: timestamp,
          load1: res.cpu.loadAverage[0],
          load5: res.cpu.loadAverage[1],
          load15: res.cpu.loadAverage[2]
        }];
        return next.slice(-25);
      });
      
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch CPU stats:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-[var(--primary)] animate-spin" />
        <span className="text-sm text-[var(--muted-foreground)]">Loading CPU Performance...</span>
      </div>
    );
  }

  const temp = data.cpu.tempC;
  const tempColor = temp > 75 ? "text-[var(--error)] animate-pulse" : temp > 60 ? "text-[var(--warning)]" : "text-[var(--success)]";
  const tempBg = temp > 75 ? "bg-[var(--error)]/10" : temp > 60 ? "bg-[var(--warning)]/10" : "bg-[var(--success)]/10";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">CPU Performance</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Real-time processor utilization, temperature, and clock frequency
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] font-mono">
          <span>Board: {data.device.board}</span>
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
          </span>
        </div>
      </div>

      {/* Grid: Live Utilization & Freq/Temp */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* radial gauge representation */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[var(--primary)]" />
              Overall Load
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center p-6 space-y-4">
            <div className="relative w-40 h-40 flex items-center justify-center">
              {/* SVG circular gauge */}
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  stroke="var(--border)"
                  strokeWidth="8"
                  fill="transparent"
                  className="opacity-30"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  stroke="var(--primary)"
                  strokeWidth="8"
                  fill="transparent"
                  strokeDasharray="251.2"
                  strokeDashoffset={251.2 - (251.2 * data.cpu.overallUsage) / 100}
                  className="transition-all duration-500 ease-out"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-3xl font-extrabold text-[var(--foreground)]">{data.cpu.overallUsage}%</span>
                <span className="text-xxs text-[var(--muted-foreground)] font-semibold uppercase tracking-wider">Utilization</span>
              </div>
            </div>
            
            {data.cpu.throttling && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--error)]/15 text-[var(--error)] text-xs font-semibold animate-pulse border border-[var(--error)]/25">
                <AlertTriangle className="w-4 h-4" /> CPU Thermal Throttled!
              </div>
            )}
          </CardContent>
        </Card>

        {/* Temperature & clock frequency stats */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Processor Telemetry
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={`p-4 rounded-xl border border-[var(--border)] ${tempBg} flex items-center gap-4`}>
              <Thermometer className={`w-10 h-10 ${tempColor}`} />
              <div>
                <span className="text-xs text-[var(--muted-foreground)]">CPU SoC Temperature</span>
                <h4 className={`text-2xl font-bold ${tempColor} mt-1`}>{data.cpu.tempC.toFixed(1)} °C</h4>
                <p className="text-xxs text-[var(--muted-foreground)] mt-1">Target range: &lt; 70°C</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 flex items-center gap-4">
              <Activity className="w-10 h-10 text-[var(--primary)] animate-pulse" />
              <div>
                <span className="text-xs text-[var(--muted-foreground)]">CPU Scaling Frequency</span>
                <h4 className="text-2xl font-bold text-[var(--foreground)] mt-1">{data.cpu.frequencyMhz} MHz</h4>
                <p className="text-xxs text-[var(--muted-foreground)] mt-1">Max Clock: 1.51 GHz (Quad Core)</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/30 flex items-center gap-4 sm:col-span-2">
              <Clock className="w-10 h-10 text-[var(--success)]" />
              <div className="flex-1">
                <span className="text-xs text-[var(--muted-foreground)]">System Load Average</span>
                <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                  <div className="bg-[var(--card)]/80 p-2 rounded border border-[var(--border)]">
                    <div className="text-xxs text-[var(--muted-foreground)]">1 Min</div>
                    <div className="text-sm font-mono font-bold text-[var(--foreground)] mt-0.5">{data.cpu.loadAverage[0].toFixed(2)}</div>
                  </div>
                  <div className="bg-[var(--card)]/80 p-2 rounded border border-[var(--border)]">
                    <div className="text-xxs text-[var(--muted-foreground)]">5 Min</div>
                    <div className="text-sm font-mono font-bold text-[var(--foreground)] mt-0.5">{data.cpu.loadAverage[1].toFixed(2)}</div>
                  </div>
                  <div className="bg-[var(--card)]/80 p-2 rounded border border-[var(--border)]">
                    <div className="text-xxs text-[var(--muted-foreground)]">15 Min</div>
                    <div className="text-sm font-mono font-bold text-[var(--foreground)] mt-0.5">{data.cpu.loadAverage[2].toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grid: CPU History charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Real-time CPU Usage and Temp chart */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              Utilization & Temperature History
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cpuHistory}>
                <defs>
                  <linearGradient id="cpuUsage" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" className="opacity-30" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={9} className="font-mono" />
                <YAxis stroke="var(--muted-foreground)" fontSize={9} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: "var(--card)", borderColor: "var(--border)" }} />
                <Area type="monotone" name="CPU Usage %" dataKey="usage" stroke="var(--primary)" strokeWidth={2} fillOpacity={1} fill="url(#cpuUsage)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Load Average Area chart */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              System Load Average Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={loadHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" className="opacity-30" />
                <XAxis dataKey="time" stroke="var(--muted-foreground)" fontSize={9} className="font-mono" />
                <YAxis stroke="var(--muted-foreground)" fontSize={9} />
                <Tooltip contentStyle={{ background: "var(--card)", borderColor: "var(--border)" }} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Line type="monotone" name="1 Min" dataKey="load1" stroke="var(--primary)" strokeWidth={2} dot={false} />
                <Line type="monotone" name="5 Min" dataKey="load5" stroke="var(--success)" strokeWidth={2} dot={false} />
                <Line type="monotone" name="15 Min" dataKey="load15" stroke="var(--warning)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Core Breakdown Progress */}
      <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Multi-Core Utilization (Cortex-A53 Quad-Core)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.cpu.cores.map((usage: number, idx: number) => (
            <div key={idx} className="space-y-1.5">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-[var(--foreground)]">Core {idx}</span>
                <span className="font-mono text-[var(--primary)]">{usage}%</span>
              </div>
              <Progress value={usage} className="h-2 bg-[var(--secondary)]" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
