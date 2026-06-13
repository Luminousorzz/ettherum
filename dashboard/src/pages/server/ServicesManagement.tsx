import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Activity, Layers, Terminal } from "lucide-react";
import { fetchApi } from "@/lib/api";

export default function ServicesManagement() {
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
      console.error("Failed to fetch Services stats:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 3500);
    return () => clearInterval(interval);
  }, []);

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-[var(--primary)] animate-spin" />
        <span className="text-sm text-[var(--muted-foreground)]">Loading Services & Docker...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Services & Docker</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Monitor background services status, website daemons, custom script parameters, and running Docker containers
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

      {/* Grid: Services list */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Systemctl units list */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--primary)]" />
              Systemctl Services
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {data.services.map((s: any, idx: number) => (
              <div key={idx} className="p-3 bg-[var(--secondary)]/30 rounded-xl border border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${s.active ? "bg-[var(--success)]" : "bg-[var(--muted)]"}`}></span>
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${s.active ? "bg-[var(--success)]" : "bg-[var(--muted)]"}`}></span>
                  </span>
                  <div className="min-w-0">
                    <div className="font-bold text-xs text-[var(--foreground)] truncate">{s.name}.service</div>
                    <div className="text-[9px] text-[var(--muted-foreground)] truncate">{s.label}</div>
                  </div>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase font-mono ${s.active ? "bg-[var(--success)]/10 text-[var(--success)]" : "bg-[var(--muted)]/15 text-[var(--muted-foreground)]"}`}>
                  {s.active ? "Active" : "Dead"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Custom Arguments / Parameters Tracker */}
        <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[var(--success)]" />
              Custom Arguments Tracker
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-xs">
            <p className="text-xxs text-[var(--muted-foreground)] font-sans">
              Active launch parameters detected on the pool proxy core processes:
            </p>
            <div className="p-3 bg-black/80 rounded-lg text-[var(--success)] border border-[var(--border)] space-y-1.5 overflow-x-auto leading-relaxed">
              <div><span className="text-white">etteum-pool:</span> --port 1930 --ws-port 1930/ws --db sqlite --env production</div>
              <div className="border-t border-white/5 pt-1.5"><span className="text-white">nginx-server:</span> -c /etc/nginx/nginx.conf -g "daemon off;"</div>
              <div className="border-t border-white/5 pt-1.5"><span className="text-white">docker-bridge:</span> --ip-masq=true --iptables=true</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Docker container list */}
      <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--warning)]" />
            Docker Container Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.dockerContainers.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] flex items-center justify-center h-28 border border-dashed border-[var(--border)] rounded-xl">
              No running Docker containers detected on this STB device
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--card)]/30">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--secondary)]/60 text-[var(--muted-foreground)] border-b border-[var(--border)] text-xxs font-semibold uppercase tracking-wider">
                    <th className="p-3">Container Name</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">CPU Usage</th>
                    <th className="p-3 text-right">Memory (Used / Limit)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dockerContainers.map((c: any, idx: number) => (
                    <tr key={idx} className="border-b border-[var(--border)]/40 last:border-b-0 hover:bg-[var(--secondary)]/30 transition-all">
                      <td className="p-3 font-mono font-bold text-[var(--foreground)]">{c.name}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded bg-[var(--success)]/10 text-[var(--success)] text-xxs uppercase font-semibold">
                          {c.status}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--success)] font-semibold">{c.cpu}</td>
                      <td className="p-3 text-right font-mono text-[var(--primary)] font-semibold">{c.memory}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
