import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  Shield,
  Users,
  Terminal as TerminalIcon,
  AlertTriangle,
  RefreshCw,
  Lock,
  ChevronDown,
  ChevronUp,
  Skull
} from "lucide-react";
import { fetchApi } from "@/lib/api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";

export default function SystemSecurity() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logsExpanded, setLogsExpanded] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const fetchStats = async () => {
    try {
      setRefreshing(true);
      const res = await fetchApi<any>("/api/system/analytics");
      setData(res);
      setLoading(false);
    } catch (err) {
      console.error("Failed to fetch System & Security stats:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll logs to bottom when expanded
  useEffect(() => {
    if (logsExpanded && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [data, logsExpanded]);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-[var(--primary)] animate-spin" />
        <span className="text-sm text-[var(--muted-foreground)]">Loading System & Security...</span>
      </div>
    );
  }

  // Format processes data for Recharts horizontal bar chart
  const processChartData = [...data.topProcesses]
    .slice(0, 5)
    .reverse() // Reverse so the highest value is at the top of the vertical layout
    .map((p: any) => ({
      name: p.name,
      displayName: `${p.name} (PID: ${p.pid})`,
      cpu: p.cpu,
      ram: p.ram,
      user: p.user,
      pid: p.pid
    }));

  // Style log line helper
  const formatLogLine = (line: string, idx: number) => {
    const isError = /fail|invalid|err|crit|alert|emerg/i.test(line);
    const isSuccess = /accepted|success|ok/i.test(line);
    
    let textColor = "text-zinc-300";
    if (isError) {
      textColor = "text-[var(--error)] font-semibold";
    } else if (isSuccess) {
      textColor = "text-[var(--success)] font-semibold";
    }

    // Try parsing out timestamp in brackets [   0.000000]
    const timestampMatch = line.match(/^\[\s*[\d.]+\s*\]/);
    if (timestampMatch) {
      const ts = timestampMatch[0];
      const rest = line.substring(ts.length);
      return (
        <div key={idx} className="py-0.5 border-b border-zinc-900/40 last:border-b-0 hover:bg-zinc-900/30 font-mono text-xxs">
          <span className="text-zinc-500 font-bold mr-2 select-none">{ts}</span>
          <span className={textColor}>{rest}</span>
        </div>
      );
    }

    return (
      <div key={idx} className={`py-0.5 border-b border-zinc-900/40 last:border-b-0 hover:bg-zinc-900/30 font-mono text-xxs ${textColor}`}>
        {line}
      </div>
    );
  };

  // Custom Tooltip for Process Bar Chart
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const dataInfo = payload[0].payload;
      return (
        <div className="bg-[var(--card)] border border-[var(--border)] p-3 rounded-lg shadow-xl text-xs space-y-1.5 backdrop-blur-md">
          <p className="font-bold text-[var(--foreground)]">{dataInfo.name}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-xxs text-[var(--muted-foreground)]">
            <span>PID:</span>
            <span className="text-white text-right">{dataInfo.pid}</span>
            <span>User:</span>
            <span className="text-white text-right">{dataInfo.user}</span>
            <span>CPU Usage:</span>
            <span className="text-[var(--primary)] text-right font-bold">{dataInfo.cpu}%</span>
            <span>RAM Usage:</span>
            <span className="text-[var(--warning)] text-right font-bold">{dataInfo.ram}%</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">System & Security</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Track running processes, active SSH connection remote IPs, login attempts, and kernel events
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] font-mono">
          <span>Uptime: {Math.round(data.device.uptime / 3600)} hrs</span>
          <span className="relative flex h-2.5 w-2.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${refreshing ? "bg-[var(--primary)]" : "bg-[var(--success)]"}`}></span>
          </span>
        </div>
      </div>

      {/* Security Alert Block (Failed Logins Warning) */}
      {data.security.failedLogins > 0 && (
        <Alert variant="error" className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-[var(--error)] shrink-0 animate-bounce" />
          <div className="flex-1">
            <div className="font-bold text-sm text-[var(--error)]">Failed Login Alerts Detected</div>
            <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
              There have been <span className="text-[var(--error)] font-bold">{data.security.failedLogins} failed password attempts</span> logged in the system auth history.
              Please check your active SSH session IPs below to ensure authorized access only.
            </div>
          </div>
          <Badge variant="error" className="ml-auto">
            {data.security.failedLogins} Attempts
          </Badge>
        </Alert>
      )}

      {/* Grid: Top Processes & Active SSH sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Top Processes (Recharts Horizontal Bar Chart) */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md lg:col-span-7">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
              <Skull className="w-4 h-4 text-[var(--error)]" />
              Top 5 Resource-Consuming Processes
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[320px] pr-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={processChartData}
                layout="vertical"
                margin={{ top: 5, right: 10, left: 15, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" className="opacity-30" />
                <XAxis type="number" stroke="var(--muted-foreground)" fontSize={9} className="font-mono" />
                <YAxis
                  dataKey="displayName"
                  type="category"
                  stroke="var(--muted-foreground)"
                  fontSize={9}
                  className="font-mono"
                  width={140}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                <Bar
                  dataKey="cpu"
                  name="CPU Usage (%)"
                  fill="var(--primary)"
                  radius={[0, 4, 4, 0]}
                  barSize={12}
                />
                <Bar
                  dataKey="ram"
                  name="RAM Usage (%)"
                  fill="var(--warning)"
                  radius={[0, 4, 4, 0]}
                  barSize={12}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Active SSH Sessions List */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md lg:col-span-5 flex flex-col justify-between">
          <div>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
                <Users className="w-4 h-4 text-[var(--success)]" />
                Active SSH Sessions ({data.security.sshSessionsCount})
              </CardTitle>
              <Badge variant={data.security.sshSessionsCount > 1 ? "warning" : "success"}>
                {data.security.sshSessionsCount} Connected
              </Badge>
            </CardHeader>
            <CardContent className="pt-0">
              {data.security.sshSessionsList.length === 0 ? (
                <div className="text-xs text-[var(--muted-foreground)] flex flex-col items-center justify-center h-48 border border-dashed border-[var(--border)] rounded-xl gap-2">
                  <Lock className="w-8 h-8 text-[var(--muted-foreground)] opacity-40" />
                  <span>No active remote terminal connections</span>
                </div>
              ) : (
                <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1">
                  {data.security.sshSessionsList.map((session: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 bg-[var(--secondary)]/30 rounded-xl border border-[var(--border)] flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[var(--foreground)] font-mono">
                          {session.user}@{data.device.board.split(" ")[0].toLowerCase()}
                        </span>
                        <Badge variant="outline" className="text-[9px] font-mono py-0 px-1.5">
                          {session.terminal}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-x-2 text-[10px] text-[var(--muted-foreground)] font-mono">
                        <span>Remote IP:</span>
                        <span className="text-right text-[var(--primary)] font-bold">{session.ip}</span>
                        <span>Login Time:</span>
                        <span className="text-right text-zinc-400">{session.loginTime}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </div>

          {/* Quick connection tip */}
          <div className="p-4 border-t border-[var(--border)] bg-[var(--secondary)]/10 rounded-b-xl">
            <div className="flex items-start gap-2.5 text-xxs text-[var(--muted-foreground)] leading-normal">
              <Shield className="w-3.5 h-3.5 text-[var(--primary)] shrink-0 mt-0.5" />
              <span>
                To restrict SSH logins, modify <code>/etc/ssh/sshd_config</code> to configure key-based authentication and disable root password logins.
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* System Logs Console */}
      <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md overflow-hidden">
        <CardHeader
          className="flex flex-row items-center justify-between cursor-pointer py-3 hover:bg-[var(--secondary)]/10 transition-colors select-none"
          onClick={() => setLogsExpanded(!logsExpanded)}
        >
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-[var(--primary)]" />
            Critical Kernel & System Logs (dmesg / syslog)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xxs font-mono">
              {data.logs.length} events
            </Badge>
            {logsExpanded ? <ChevronUp className="w-4 h-4 text-[var(--muted-foreground)]" /> : <ChevronDown className="w-4 h-4 text-[var(--muted-foreground)]" />}
          </div>
        </CardHeader>
        {logsExpanded && (
          <CardContent className="pt-0">
            <div className="bg-black/95 border border-zinc-900 rounded-lg p-3 h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-850 flex flex-col justify-start">
              <div className="flex-1">
                {data.logs.length === 0 ? (
                  <div className="text-zinc-600 text-xxs font-mono flex items-center justify-center h-full">
                    No critical kernel/system log errors recorded.
                  </div>
                ) : (
                  data.logs.map((line: string, idx: number) => formatLogLine(line, idx))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
