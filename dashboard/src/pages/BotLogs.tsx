import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clearAuthLogs, fetchAuthLogs, fetchAuthQueue, fetchWarmupQueue, loginAccount, loginAccounts, stopAllAccounts } from "@/lib/api";
import { useWsEvent, useWsStatus } from "@/hooks/useWebSocket";
import { AlertTriangle, CheckCircle, ChevronDown, RefreshCw, RotateCcw, Trash2, Radio, StopCircle, Laptop, Tv } from "lucide-react";
import { formatTimeID } from "@/lib/utils";

interface AuthLog {
  id: number;
  timestamp: string;
  type: string;
  accountId?: number;
  email?: string;
  provider?: string;
  step?: string;
  message?: string;
  error?: string;
  data?: unknown;
}

interface ProcessLog {
  key: string;
  operation: string;
  latest: AuthLog;
  events: AuthLog[];
  startedAt: string;
  updatedAt: string;
}

const liveTypes: string[] = [
  "queue_added", "queue_processing", "login_progress", "login_success", "login_failed", "queue_complete", "queue_cleared",
];
// Note: warmup_* events are explicitly filtered out - Login Logs only shows login operations

function statusVariant(type: string): "success" | "warning" | "error" | "secondary" {
  if (type.includes("success") || type === "queue_complete" || type === "warmup_complete") return "success";
  if (type.includes("failed") || type.includes("auth_error")) return "error";
  if (type.includes("processing") || type.includes("progress") || type.includes("exhausted") || type.includes("transient") || type.includes("unsupported")) return "warning";
  return "secondary";
}

function processStatusVariant(process: ProcessLog): "success" | "warning" | "error" | "secondary" {
  if (process.events.some((log) => log.type === "login_success" || log.type === "warmup_success")) return "success";
  if (process.events.some((log) => log.type === "login_failed" || log.type === "warmup_auth_error")) return "error";
  return statusVariant(process.latest.type);
}

function processStatusLabel(process: ProcessLog) {
  if (process.events.some((log) => log.type === "login_success" || log.type === "warmup_success")) return "success";
  if (process.events.some((log) => log.type === "login_failed" || log.type === "warmup_auth_error")) return "error";
  return statusLabel(process.latest.type);
}

function providerLabel(provider?: string) {
  if (!provider) return "-";
  return provider === "codebuddy" ? "CodeBuddy" : provider.charAt(0).toUpperCase() + provider.slice(1);
}

function operationFor(type: string) {
  return type.startsWith("warmup_") ? "WarmUp" : "Login";
}

function processKey(log: AuthLog) {
  const account = log.accountId || log.email || log.id;
  return `${operationFor(log.type)}-${account}`;
}

function statusLabel(type: string) {
  return type.replace(/^login_/, "").replace(/^warmup_/, "").replace(/^queue_/, "").replace(/_/g, " ");
}

function mergeLogs(current: AuthLog[], incoming: AuthLog[]) {
  const map = new Map<string, AuthLog>();
  for (const log of [...current, ...incoming]) {
    const key = `${log.id}-${log.timestamp}-${log.type}-${log.accountId || ""}-${log.step || ""}`;
    map.set(key, log);
  }
  return [...map.values()]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

function logsToProcesses(logs: AuthLog[]): ProcessLog[] {
  const groups = new Map<string, ProcessLog>();
  const oldestFirst = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (const log of oldestFirst) {
    const key = processKey(log);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        operation: operationFor(log.type),
        latest: log,
        events: [log],
        startedAt: log.timestamp,
        updatedAt: log.timestamp,
      });
      continue;
    }

    existing.events.push(log);
    existing.latest = { ...log, email: log.email || existing.latest.email, provider: log.provider || existing.latest.provider };
    existing.updatedAt = log.timestamp;
  }

  return [...groups.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export default function BotLogs() {
  const [logs, setLogs] = useState<AuthLog[]>([]);
  const [queue, setQueue] = useState<any>(null);
  const [warmupQueue, setWarmupQueue] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 25;
  const queueRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsStatus = useWsStatus();
  const connected = wsStatus === "open";

  const [screenshots, setScreenshots] = useState<Record<number, { email: string; provider: string; imageData: string; timestamp: number }>>({});

  // Clean up stale screens after 15 seconds of no updates
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setScreenshots((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, s] of Object.entries(next)) {
          if (now - s.timestamp > 15000) {
            delete next[Number(id)];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    const [logRes, queueRes] = await Promise.all([
      fetchAuthLogs(300) as Promise<{ data: AuthLog[] }>,
      fetchAuthQueue().catch(() => null),
    ]);
    // Filter out all warmup logs - Login Logs only shows login operations
    setLogs((current) => mergeLogs(current, (logRes.data || []).filter((log) => !log.type.startsWith("warmup_"))));
    setQueue(queueRes);
  }

  const refreshQueues = useCallback(async () => {
    const queueRes = await fetchAuthQueue().catch(() => null);
    setQueue(queueRes);
  }, []);

  const scheduleQueueRefresh = useCallback(() => {
    if (queueRefreshTimerRef.current) return;
    queueRefreshTimerRef.current = setTimeout(() => {
      queueRefreshTimerRef.current = null;
      refreshQueues();
    }, 300);
  }, [refreshQueues]);

  useEffect(() => {
    load().catch(() => {});
    return () => {
      if (queueRefreshTimerRef.current) {
        clearTimeout(queueRefreshTimerRef.current);
        queueRefreshTimerRef.current = null;
      }
    };
  }, []);

  useWsEvent(liveTypes, (msg) => {
    // Skip all warmup events - Login Logs only shows login operations
    if (msg.type.startsWith("warmup_")) return;

    if (msg.type === "queue_complete") {
      setQueue((current: any) => ({ ...(current || {}), ...(msg.data || {}), queued: 0, active: 0, processing: false }));
    }
    if (msg.type === "queue_cleared") {
      setQueue((current: any) => ({ ...(current || {}), queued: 0, active: 0, processing: false }));
    }
    const data = msg.data || {};
    const log: AuthLog = {
      id: data.logId || data.id || Date.now(),
      timestamp: data.timestamp || new Date().toISOString(),
      type: msg.type,
      accountId: data.accountId || data.id,
      email: data.email,
      provider: data.provider,
      step: data.step,
      message: data.message || data.error || msg.type,
      error: data.error,
      data,
    };
    setLogs((current) => mergeLogs(current, [log]));
    scheduleQueueRefresh();
  });

  useWsEvent("live_screenshot", (msg) => {
    const data = msg.data;
    if (data && data.accountId) {
      setScreenshots((prev) => ({
        ...prev,
        [data.accountId]: {
          email: data.email,
          provider: data.provider,
          imageData: data.imageData,
          timestamp: Date.now(),
        },
      }));
    }
  });

  useWsEvent(["login_success", "login_failed"], (msg) => {
    const data = msg.data;
    if (data && (data.id || data.accountId)) {
      const id = data.id || data.accountId;
      setScreenshots((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  });

  const failed = useMemo(() => logs.filter((log) => log.type === "login_failed"), [logs]);
  const failedAccounts = useMemo(() => {
    const map = new Map<string, AuthLog>();
    for (const log of failed) {
      const key = `${log.accountId || log.email || log.id}-${log.provider || "unknown"}`;
      if (!map.has(key) || new Date(log.timestamp).getTime() > new Date(map.get(key)!.timestamp).getTime()) {
        map.set(key, log);
      }
    }
    return [...map.values()];
  }, [failed]);
  const processes = useMemo(() => {
    return logsToProcesses(logs).filter((process) => {
      // Exclude pending items that haven't started processing yet
      if (process.events.length === 1) {
        const type = process.events[0].type;
        if (type === "queue_added" || type === "warmup_queue_added") return false;
      }
      return true;
    });
  }, [logs]);
  const running = Number(queue?.active || 0);
  const queued = Number(queue?.queued || 0);
  const warmupRunning = Number(warmupQueue?.active || 0);
  const warmupQueued = Number(warmupQueue?.queued || 0);

  // Use backend queue stats for accurate counts (lightweight, no frontend recalculation)
  const totalProgress = running + warmupRunning;
  const totalSuccess = Number(queue?.totalSuccess || 0) + Number(warmupQueue?.totalSuccess || 0);
  const totalFailed = Number(queue?.totalFailed || 0) + Number(warmupQueue?.totalFailed || 0);
  const totalQueued = queued + warmupQueued;

  async function handleClear() {
    await clearAuthLogs();
    setLogs([]);
  }

  async function handleStopAll() {
    await stopAllAccounts();
    await load().catch(() => {});
  }

  async function handleRetry(accountId?: number) {
    if (!accountId) return;
    await loginAccount(accountId);
    await load().catch(() => {});
  }

  async function handleRetryAll() {
    const ids = Array.from(new Set(failedAccounts.map((log) => log.accountId).filter((id): id is number => Boolean(id))));
    if (ids.length === 0) return;
    await loginAccounts(ids);
    await load().catch(() => {});
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Login Logs</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Live progress for auto-login bot, including failed accounts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={connected ? "success" : "secondary"}>{connected ? "Live" : "Disconnected"}</Badge>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-4 h-4 mr-2" />Refresh</Button>
          <Button variant="destructive" size="sm" onClick={handleStopAll}><StopCircle className="w-4 h-4 mr-2" />Stop All</Button>
          <Button variant="outline" size="sm" onClick={handleClear}><Trash2 className="w-4 h-4 mr-2" />Clear</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-[var(--border)]"><CardContent className="p-4"><p className="text-xs text-[var(--muted-foreground)]">Queue</p><p className="text-2xl font-bold">{totalQueued}</p></CardContent></Card>
        <Card className="border-[var(--border)]"><CardContent className="p-4"><p className="text-xs text-[var(--muted-foreground)]">Progress</p><p className="text-2xl font-bold text-[var(--warning)]">{totalProgress}</p></CardContent></Card>
        <Card className="border-[var(--border)]"><CardContent className="p-4"><p className="text-xs text-[var(--muted-foreground)]">Success</p><p className="text-2xl font-bold text-[var(--success)]">{totalSuccess}</p></CardContent></Card>
        <Card className="border-[var(--border)]"><CardContent className="p-4"><p className="text-xs text-[var(--muted-foreground)]">Failed</p><p className="text-2xl font-bold text-[var(--error)]">{totalFailed}</p></CardContent></Card>
      </div>

      {(totalProgress > 0 || totalQueued > 0) && (
        <div className="rounded-md border border-[var(--warning)]/30 bg-[var(--warning)]/5 p-3 text-sm text-[var(--warning)] flex items-center gap-2">
          <Radio className="w-4 h-4 animate-pulse" />
          Sedang berjalan: {totalProgress} processing, {totalQueued} queued. Log akan update otomatis.
        </div>
      )}

      {failedAccounts.length > 0 && (
        <Card className="border-[var(--error)]/30 bg-[var(--error)]/5">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-[var(--error)]" /> Failed Accounts</CardTitle>
              <Button variant="outline" size="sm" onClick={handleRetryAll}>
                <RotateCcw className="mr-2 h-4 w-4" /> Retry All ({failedAccounts.length})
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-md border border-[var(--error)]/20">
              {failedAccounts.map((log) => (
                <div key={`failed-${log.accountId || log.id}-${log.provider || "unknown"}`} className="grid grid-cols-[1fr_auto] gap-3 border-b border-[var(--error)]/10 px-3 py-2 text-sm last:border-0 md:grid-cols-[240px_140px_1fr_auto]">
                  <div className="truncate font-medium text-[var(--foreground)]">{log.email || `Account #${log.accountId}`}</div>
                  <div className="text-xs text-[var(--muted-foreground)] md:text-sm">{providerLabel(log.provider)}</div>
                  <div className="col-span-2 truncate text-xs text-[var(--error)] md:col-span-1" title={log.error || log.message}>{log.error || log.message}</div>
                  <Button variant="ghost" size="sm" onClick={() => handleRetry(log.accountId)} disabled={!log.accountId}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Retry
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Split CCTV Previews & Log Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 items-start">
        {/* CCTV Previews */}
        <Card className="border-[var(--border)] overflow-hidden">
          <CardHeader className="bg-[var(--secondary)]/10 border-b border-[var(--border)]">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="w-4 h-4 text-rose-500 animate-pulse" />
              Live Browser CCTV Previews
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 bg-zinc-950/40 min-h-[350px] flex flex-col justify-center">
            {Object.keys(screenshots).length === 0 ? (
              <div className="text-center p-8 text-[var(--muted-foreground)] space-y-2">
                <Laptop className="w-12 h-12 mx-auto opacity-30 text-[var(--primary)]" />
                <h4 className="text-sm font-semibold">No Active Browser Sessions</h4>
                <p className="text-xs opacity-70">Screenshots from active login bots will appear here in real-time.</p>
              </div>
            ) : (
              <div className={`grid gap-4 ${
                Object.keys(screenshots).length === 1 
                  ? "grid-cols-1" 
                  : Object.keys(screenshots).length === 2 
                  ? "grid-cols-1 sm:grid-cols-2" 
                  : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
              }`}>
                {Object.entries(screenshots).map(([accountId, screen]) => (
                  <div key={accountId} className="border border-[var(--border)] rounded-lg overflow-hidden bg-black relative aspect-video flex items-center justify-center group shadow-md">
                    <img src={screen.imageData} alt="CCTV Screen" className="w-full h-full object-contain" />
                    <div className="absolute top-2 left-2 right-2 flex justify-between items-center bg-black/70 px-2 py-1 rounded text-[10px] text-white">
                      <span className="font-semibold truncate max-w-[70%]">{screen.email}</span>
                      <span className="flex items-center gap-1 text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded-full font-medium">
                        <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                        {providerLabel(screen.provider)}
                      </span>
                    </div>
                    <div className="absolute bottom-2 left-2 bg-black/60 px-1.5 py-0.5 rounded text-[9px] text-gray-300">
                      ID: #{accountId}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Log Progress Sidebar */}
        <Card className="border-[var(--border)]">
          <CardHeader className="bg-[var(--secondary)]/10 border-b border-[var(--border)]">
            <CardTitle className="text-base">Login Progress Logs</CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-[600px] overflow-y-auto divide-y divide-[var(--border)]">
            {processes.length === 0 ? (
              <div className="p-8 text-center text-xs text-[var(--muted-foreground)]">No logs available.</div>
            ) : (
              processes.map((process) => {
                const isExpanded = expanded === process.key;
                return (
                  <div key={process.key} className="transition-colors hover:bg-[var(--secondary)]/10">
                    <div 
                      className="p-3 text-xs flex flex-col gap-2 cursor-pointer"
                      onClick={() => setExpanded(current => current === process.key ? null : process.key)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[var(--foreground)] truncate max-w-[180px]">{process.latest.email || `#${process.latest.accountId}`}</span>
                        <span className="text-[10px] text-[var(--muted-foreground)] font-mono">{formatTimeID(process.updatedAt)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-[var(--muted-foreground)]">{providerLabel(process.latest.provider)} · {process.latest.step || process.operation}</span>
                        <Badge variant={processStatusVariant(process)} className="text-[9px] px-1 py-0 scale-90">{processStatusLabel(process)}</Badge>
                      </div>
                      <div className="text-[11px] text-[var(--muted-foreground)] line-clamp-2 leading-relaxed flex items-start gap-1.5">
                        {processStatusLabel(process) === "success" && <CheckCircle className="w-3.5 h-3.5 text-[var(--success)] shrink-0 mt-0.5" />}
                        {processStatusLabel(process) === "error" && <AlertTriangle className="w-3.5 h-3.5 text-[var(--error)] shrink-0 mt-0.5" />}
                        {processStatusLabel(process) !== "success" && processStatusLabel(process) !== "error" && <span className="h-1.5 w-1.5 rounded-full bg-[var(--warning)] shrink-0 mt-1.5" />}
                        <span className="flex-1 min-w-0">{process.latest.error || process.latest.message || "-"}</span>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="bg-[var(--secondary)]/20 p-2 space-y-1.5 border-t border-[var(--border)]">
                        {process.events.map((log) => (
                          <div key={`${log.id}-${log.timestamp}`} className="p-2 rounded bg-[var(--card)] border border-[var(--border)] text-[10px] space-y-0.5">
                            <div className="flex justify-between text-[9px] text-[var(--muted-foreground)]">
                              <span>{log.step || statusLabel(log.type)}</span>
                              <span className="font-mono">{formatTimeID(log.timestamp)}</span>
                            </div>
                            <p className={log.error ? "text-[var(--error)]" : "text-[var(--foreground)]"}>{log.error || log.message || "-"}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
