import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useWsEvent } from "@/hooks/useWebSocket";
import { fetchAccounts, fetchApi, stopAccount } from "@/lib/api";
import {
  Radio,
  StopCircle,
  AlertTriangle,
  Loader2,
  Tv,
  ListTodo,
  Terminal,
} from "lucide-react";

interface ActiveAutomationPanelProps {
  provider?: "kiro" | "kiro-pro" | "codebuddy" | "canva" | "codex" | "qoder";
}

interface AccountProgress {
  id: number;
  email: string;
  provider: string;
  status: "queued" | "running" | "success" | "failed" | "needs_manual";
  currentStep: string;
  message: string;
  error?: string;
  updatedAt: number;
}

interface LogEntry {
  id: string;
  email: string;
  step: string;
  message: string;
  timestamp: number;
  provider: string;
}

export default function ActiveAutomationPanel({ provider }: ActiveAutomationPanelProps) {
  const [accountsProgress, setAccountsProgress] = useState<Map<string, AccountProgress>>(new Map());
  const [activityLog, setActivityLog] = useState<LogEntry[]>([]);
  const [liveScreenshots, setLiveScreenshots] = useState<Map<number, string>>(new Map());
  const [activePreviewAccountId, setActivePreviewAccountId] = useState<number | null>(null);
  
  // Polling state for backup/restoration
  const [loading, setLoading] = useState(true);

  // Load active processes from server queue on mount and restore visual state
  const restoreActiveJobs = async () => {
    try {
      const queueRes = await fetchApi<{ activeAccountIds: number[]; queuedAccountIds: number[] }>("/api/auth/queue");
      const accountsRes = await fetchAccounts() as { data: any[] };

      if (!queueRes || !accountsRes?.data) return;

      const activeIds = new Set(queueRes.activeAccountIds || []);
      const queuedIds = new Set(queueRes.queuedAccountIds || []);

      if (activeIds.size === 0 && queuedIds.size === 0) {
        setAccountsProgress(new Map());
        setLoading(false);
        return;
      }

      setAccountsProgress((prev) => {
        const nextMap = new Map(prev);
        accountsRes.data.forEach((acc) => {
          if (provider && acc.provider !== provider) return;

          if (activeIds.has(acc.id)) {
            const existing = nextMap.get(acc.email);
            nextMap.set(acc.email, {
              id: acc.id,
              email: acc.email,
              provider: acc.provider,
              status: existing?.status || "running",
              currentStep: existing?.currentStep || "restored",
              message: existing?.message || "Reconnected to running worker...",
              updatedAt: Date.now(),
            });
            if (activePreviewAccountId === null) {
              setActivePreviewAccountId(acc.id);
            }
          } else if (queuedIds.has(acc.id)) {
            const existing = nextMap.get(acc.email);
            nextMap.set(acc.email, {
              id: acc.id,
              email: acc.email,
              provider: acc.provider,
              status: existing?.status || "queued",
              currentStep: "queued",
              message: "Waiting in queue...",
              updatedAt: Date.now(),
            });
          }
        });

        // Clean up completed accounts that are no longer in queue
        for (const [email, acc] of nextMap.entries()) {
          if (acc.status !== "success" && acc.status !== "failed" && !activeIds.has(acc.id) && !queuedIds.has(acc.id)) {
            nextMap.delete(email);
          }
        }

        return nextMap;
      });
    } catch (err) {
      console.error("Failed to restore active automation states:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    restoreActiveJobs();
    const interval = setInterval(restoreActiveJobs, 4000);
    return () => clearInterval(interval);
  }, [provider]);

  // Subscribe to WebSocket events
  useWsEvent(["queue_processing", "login_progress"], (msg) => {
    const data = msg.data;
    if (!data) return;
    if (provider && data.provider !== provider) return;

    // Log progress
    setActivityLog((prev) => [
      {
        id: `${data.logId || Date.now()}-${Math.random()}`,
        email: data.email,
        step: data.step || "progress",
        message: data.message || "",
        timestamp: Date.now(),
        provider: data.provider,
      },
      ...prev.slice(0, 99),
    ]);

    setAccountsProgress((prev) => {
      const existing = prev.get(data.email);
      
      let status: "running" | "needs_manual" = "running";
      if (
        /captcha|otp|2fa|verify|verification|challenge|approve|code|phone|manual/i.test(
          (data.step || "") + " " + (data.message || "")
        )
      ) {
        status = "needs_manual";
      }

      const next: AccountProgress = {
        id: data.accountId || data.id || existing?.id || 0,
        email: data.email,
        provider: data.provider,
        status: existing?.status === "success" || existing?.status === "failed" ? existing.status : status,
        currentStep: data.step || existing?.currentStep || "running",
        message: data.message || existing?.message || "",
        updatedAt: Date.now(),
      };

      const newMap = new Map(prev);
      newMap.set(data.email, next);
      return newMap;
    });

    if (data.accountId) {
      setActivePreviewAccountId((curr) => curr || data.accountId);
    }
  });

  useWsEvent("login_success", (msg) => {
    const data = msg.data;
    if (!data) return;
    if (provider && data.provider !== provider) return;

    setAccountsProgress((prev) => {
      const existing = prev.get(data.email);
      if (!existing) return prev;

      const next: AccountProgress = {
        ...existing,
        status: "success",
        currentStep: "success",
        message: "Logged in successfully!",
        updatedAt: Date.now(),
      };

      const newMap = new Map(prev);
      newMap.set(data.email, next);
      return newMap;
    });

    setActivityLog((prev) => [
      {
        id: `success-${data.accountId}-${Date.now()}`,
        email: data.email,
        step: "success",
        message: "Successfully logged in and saved credentials!",
        timestamp: Date.now(),
        provider: data.provider,
      },
      ...prev.slice(0, 99),
    ]);
  });

  useWsEvent("login_failed", (msg) => {
    const data = msg.data;
    if (!data) return;
    if (provider && data.provider !== provider) return;

    setAccountsProgress((prev) => {
      const existing = prev.get(data.email);
      if (!existing) return prev;

      const next: AccountProgress = {
        ...existing,
        status: "failed",
        currentStep: "failed",
        message: data.error || data.message || "Failed to log in",
        error: data.error || data.message,
        updatedAt: Date.now(),
      };

      const newMap = new Map(prev);
      newMap.set(data.email, next);
      return newMap;
    });

    setActivityLog((prev) => [
      {
        id: `failed-${data.accountId}-${Date.now()}`,
        email: data.email,
        step: "failed",
        message: `Login failed: ${data.error || data.message}`,
        timestamp: Date.now(),
        provider: data.provider,
      },
      ...prev.slice(0, 99),
    ]);
  });

  useWsEvent("live_screenshot", (msg) => {
    const data = msg.data;
    if (!data) return;
    if (provider && data.provider !== provider) return;
    setLiveScreenshots((prev) => new Map(prev).set(data.accountId, data.imageData));
  });

  const handleStopAccount = async (id: number, email: string) => {
    try {
      await stopAccount(id);
      setAccountsProgress((prev) => {
        const existing = prev.get(email);
        if (!existing) return prev;
        const next: AccountProgress = {
          ...existing,
          status: "failed",
          currentStep: "stopped",
          message: "Stopped by user",
          updatedAt: Date.now(),
        };
        const newMap = new Map(prev);
        newMap.set(email, next);
        return newMap;
      });
    } catch (err) {
      console.error(`Failed to stop account #${id}:`, err);
    }
  };

  const handleStopAll = async () => {
    if (confirm("Are you sure you want to stop all running workers?")) {
      try {
        await fetchApi("/api/auth/stop-all", { method: "POST" });
        setAccountsProgress(new Map());
      } catch (err) {
        console.error("Failed to stop all workers:", err);
      }
    }
  };

  const accountsArray = useMemo(() => {
    return Array.from(accountsProgress.values()).filter((acc) => {
      // Only show accounts that are actively processing, manual, or just succeeded/failed within last 30s
      if (acc.status === "queued" || acc.status === "running" || acc.status === "needs_manual") return true;
      return Date.now() - acc.updatedAt < 30000;
    });
  }, [accountsProgress]);

  const activePreviewImage = useMemo(() => {
    if (activePreviewAccountId === null) return null;
    return liveScreenshots.get(activePreviewAccountId) || null;
  }, [activePreviewAccountId, liveScreenshots]);

  const activePreviewEmail = useMemo(() => {
    if (activePreviewAccountId === null) return "";
    const found = accountsArray.find((a) => a.id === activePreviewAccountId);
    return found ? found.email : `Account #${activePreviewAccountId}`;
  }, [activePreviewAccountId, accountsArray]);

  if (accountsArray.length === 0) return null;

  return (
    <Card className="border-[var(--primary)]/30 bg-[var(--primary)]/5 overflow-hidden transition-all duration-300">
      <CardHeader className="py-3 px-4 border-b border-[var(--border)] bg-[var(--primary)]/10 flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm font-bold flex items-center gap-2 text-[var(--foreground)]">
          <Radio className="w-4 h-4 text-emerald-500 animate-pulse" />
          Active Automation Monitor
          <Badge variant="secondary" className="text-[10px] ml-1 bg-[var(--background)]">
            {accountsArray.filter((a) => a.status === "running" || a.status === "needs_manual").length} active
          </Badge>
        </CardTitle>
        <Button variant="outline" size="sm" className="h-7 text-xs border-red-500/30 text-red-500 hover:bg-red-500/10" onClick={handleStopAll}>
          <StopCircle className="w-3.5 h-3.5 mr-1" />
          Stop All
        </Button>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* Warning Banner */}
        {accountsArray.some((a) => a.status === "needs_manual") && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-500 flex items-center gap-2 animate-pulse">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Google requires verification for some accounts. Check your Windows local screen to solve the CAPTCHA or prompt.</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(300px,360px)] gap-4">
          {/* Left Block: Worker Lanes & Screenshot preview */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[1.2fr_0.8fr] gap-4">
              
              {/* Browser Stream Preview */}
              <div className="border border-[var(--border)] rounded-xl bg-zinc-950 flex flex-col overflow-hidden aspect-[16/10] max-h-[260px]">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-900 bg-zinc-900/60 text-[10px] text-zinc-400 font-mono">
                  <span className="flex items-center gap-1.5">
                    <Tv className="w-3.5 h-3.5 text-[var(--primary)]" />
                    Live Browser Stream
                  </span>
                  <span className="truncate max-w-[160px]">{activePreviewEmail.split("@")[0]}</span>
                </div>
                <div className="flex-1 flex items-center justify-center relative bg-black">
                  {activePreviewImage ? (
                    <img src={activePreviewImage} alt="Live stream" className="w-full h-full object-contain" />
                  ) : (
                    <div className="text-center p-4 text-zinc-600">
                      <Tv className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-[10px]">No active browser screen</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Workers Lanes */}
              <div className="border border-[var(--border)] rounded-xl bg-[var(--card)] flex flex-col h-[260px] overflow-hidden">
                <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--secondary)]/10 text-xs font-semibold flex items-center gap-1.5 shrink-0">
                  <ListTodo className="w-3.5 h-3.5" />
                  Workers
                </div>
                <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
                  {accountsArray.map((acc) => {
                    const isSelected = activePreviewAccountId === acc.id;
                    return (
                      <div
                        key={acc.email}
                        onClick={() => acc.id && setActivePreviewAccountId(acc.id)}
                        className={`p-2.5 transition-colors cursor-pointer text-xs flex items-center justify-between gap-2 ${
                          isSelected ? "bg-[var(--primary)]/5" : "hover:bg-[var(--secondary)]/25"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold truncate text-[var(--foreground)] leading-tight">{acc.email}</p>
                          <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5 truncate capitalize">
                            <span className="font-medium text-[var(--foreground)]">{acc.currentStep}:</span> {acc.message}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            className="text-[9px] px-1 py-0"
                            variant={
                              acc.status === "success"
                                ? "success"
                                : acc.status === "failed"
                                ? "destructive"
                                : acc.status === "needs_manual"
                                ? "warning"
                                : "secondary"
                            }
                          >
                            {acc.status}
                          </Badge>
                          {(acc.status === "running" || acc.status === "needs_manual") && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStopAccount(acc.id, acc.email);
                              }}
                              className="text-red-500 hover:text-red-600 hover:bg-red-500/10 p-1 rounded transition-colors"
                              title="Stop worker"
                            >
                              <StopCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>

          {/* Right Block: Scrolled live console log */}
          <div className="border border-[var(--border)] rounded-xl bg-zinc-950 text-zinc-300 font-mono text-[10px] flex flex-col h-[260px] overflow-hidden">
            <div className="px-3 py-2 border-b border-zinc-900 bg-zinc-900/50 flex items-center gap-1.5 shrink-0 text-zinc-400">
              <Terminal className="w-3.5 h-3.5 text-zinc-500" />
              Live Console Output
            </div>
            <div className="flex-1 p-3 overflow-y-auto space-y-2.5">
              {activityLog.length === 0 ? (
                <p className="text-zinc-600 italic">Listening for output lines...</p>
              ) : (
                activityLog.map((log) => (
                  <div key={log.id} className="border-b border-zinc-900 pb-1.5 last:border-0 last:pb-0">
                    <div className="flex justify-between text-[9px] text-zinc-500 mb-0.5">
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className="font-semibold text-zinc-400 truncate max-w-[120px]">{log.email.split("@")[0]}</span>
                    </div>
                    <p className="text-zinc-300">
                      <span className="text-[var(--primary)] font-bold mr-1">[{log.step}]:</span>
                      {log.message}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
