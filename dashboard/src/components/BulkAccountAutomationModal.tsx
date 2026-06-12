import { useState, useMemo, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useWsEvent, useWsStatus } from "@/hooks/useWebSocket";
import { importAccounts, stopAccount, fetchAccounts } from "@/lib/api";
import {
  Radio,
  Play,
  StopCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Tv,
  ListTodo,
  ExternalLink,
  Laptop,
  CheckCircle,
} from "lucide-react";

interface BulkAccountAutomationModalProps {
  isOpen: boolean;
  onClose: () => void;
  provider: "kiro" | "kiro-pro" | "codebuddy" | "canva" | "codex" | "qoder" | "outlook";
  serviceName: string;
  onSuccess?: () => void;
}

interface AccountProgress {
  email: string;
  accountId?: number;
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
}

export default function BulkAccountAutomationModal({
  isOpen,
  onClose,
  provider,
  serviceName,
  onSuccess,
}: BulkAccountAutomationModalProps) {
  const [bulkText, setBulkText] = useState("");
  const [concurrency, setConcurrency] = useState(2);
  const [browserEngine, setBrowserEngine] = useState("camoufox");
  const [headless, setHeadless] = useState(true); // Default true for hidden browser!
  
  const [importing, setImporting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Automation states
  const [accountsProgress, setAccountsProgress] = useState<Map<string, AccountProgress>>(new Map());
  const [activityLog, setActivityLog] = useState<LogEntry[]>([]);
  const [liveScreenshots, setLiveScreenshots] = useState<Map<number, string>>(new Map());
  const [activePreviewAccountId, setActivePreviewAccountId] = useState<number | null>(null);
  
  // Agent connection state
  const [agentConnected, setAgentConnected] = useState(false);
  const wsStatus = useWsStatus();

  // Reset modal state
  const resetState = () => {
    setBulkText("");
    setConcurrency(2);
    setBrowserEngine("camoufox");
    setHeadless(false);
    setImporting(false);
    setIsRunning(false);
    setError(null);
    setSuccessMsg(null);
    setAccountsProgress(new Map());
    setActivityLog([]);
    setLiveScreenshots(new Map());
    setActivePreviewAccountId(null);
  };

  useEffect(() => {
    if (isOpen) {
      // Auto-detect agent status on open by checking server info
      fetch(`${window.location.origin.replace("1931", "1930")}/api/info`)
        .then((r) => r.json())
        .then((data) => {
          if (typeof data.wsClients === "number") {
            // Wait, we can fetch active agent status or let ws events set it
          }
        })
        .catch(() => {});
    } else {
      resetState();
    }
  }, [isOpen]);

  // Subscribe to WebSocket events
  useWsEvent("connected", (msg) => {
    if (msg.data && typeof msg.data.agentConnected === "boolean") {
      setAgentConnected(msg.data.agentConnected);
    }
  });

  useWsEvent("agent_status", (msg) => {
    if (msg.data && typeof msg.data.connected === "boolean") {
      setAgentConnected(msg.data.connected);
    }
  });

  useWsEvent(["queue_processing", "login_progress"], (msg) => {
    const data = msg.data;
    if (!data || data.provider !== provider) return;

    // Log progress
    setActivityLog((prev) => [
      {
        id: `${data.logId || Date.now()}-${Math.random()}`,
        email: data.email,
        step: data.step || "progress",
        message: data.message || "",
        timestamp: Date.now(),
      },
      ...prev.slice(0, 99),
    ]);

    setAccountsProgress((prev) => {
      const existing = prev.get(data.email);
      
      // Determine if manual interaction is needed (CAPTCHA, OTP, etc.)
      let status: "running" | "needs_manual" = "running";
      if (
        /captcha|otp|2fa|verify|verification|challenge|approve|code|phone|manual/i.test(
          (data.step || "") + " " + (data.message || "")
        )
      ) {
        status = "needs_manual";
      }

      const next: AccountProgress = {
        email: data.email,
        accountId: data.accountId || existing?.accountId,
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
    if (!data || data.provider !== provider) return;

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
      },
      ...prev.slice(0, 99),
    ]);
  });

  useWsEvent("login_failed", (msg) => {
    const data = msg.data;
    if (!data || data.provider !== provider) return;

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
      },
      ...prev.slice(0, 99),
    ]);
  });

  useWsEvent("live_screenshot", (msg) => {
    const data = msg.data;
    if (!data || data.provider !== provider) return;
    setLiveScreenshots((prev) => new Map(prev).set(data.accountId, data.imageData));
  });

  // Start import action
  const handleStartImport = async () => {
    setError(null);
    setSuccessMsg(null);

    const lines = bulkText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      setError("Please enter at least one email|password line");
      return;
    }

    setImporting(true);

    try {
      const res = await importAccounts(bulkText, [provider], {
        headless,
        browserEngine,
        concurrency,
      });

      setSuccessMsg(res.message || "Accounts imported and queued successfully.");
      
      const newProgressMap = new Map<string, AccountProgress>();
      if (res.queuedAccounts && Array.isArray(res.queuedAccounts)) {
        res.queuedAccounts.forEach((acc: any) => {
          newProgressMap.set(acc.email, {
            email: acc.email,
            accountId: acc.id,
            status: "queued",
            currentStep: "queued",
            message: "Queued in pool proxy...",
            updatedAt: Date.now(),
          });
        });
      } else {
        // Fallback: populate from lines
        lines.forEach((line) => {
          const email = line.split(/[|:\s]+/)[0]?.trim();
          if (email && email.includes("@")) {
            newProgressMap.set(email, {
              email,
              status: "queued",
              currentStep: "queued",
              message: "Importing...",
              updatedAt: Date.now(),
            });
          }
        });
      }

      setAccountsProgress(newProgressMap);
      setIsRunning(true);
    } catch (err: any) {
      setError(err.message || "Failed to start bulk import");
    } finally {
      setImporting(false);
    }
  };

  // Stop single account process
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
    } catch (err: any) {
      console.error(`Failed to stop account #${id}:`, err);
    }
  };

  // Derived states
  const accountsArray = useMemo(() => Array.from(accountsProgress.values()), [accountsProgress]);
  
  const stats = useMemo(() => {
    const total = accountsArray.length;
    const queued = accountsArray.filter((a) => a.status === "queued").length;
    const running = accountsArray.filter((a) => a.status === "running").length;
    const success = accountsArray.filter((a) => a.status === "success").length;
    const failed = accountsArray.filter((a) => a.status === "failed").length;
    const manual = accountsArray.filter((a) => a.status === "needs_manual").length;
    return { total, queued, running, success, failed, manual };
  }, [accountsArray]);

  const previewImage = useMemo(() => {
    if (activePreviewAccountId === null) return null;
    return liveScreenshots.get(activePreviewAccountId) || null;
  }, [activePreviewAccountId, liveScreenshots]);

  const activePreviewEmail = useMemo(() => {
    if (activePreviewAccountId === null) return "";
    const acc = accountsArray.find((a) => a.accountId === activePreviewAccountId);
    return acc ? acc.email : `Account #${activePreviewAccountId}`;
  }, [activePreviewAccountId, accountsArray]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !importing && onClose()}>
      <DialogContent className="max-w-[94vw] w-[1200px] h-[90vh] flex flex-col p-6 overflow-hidden gap-0 rounded-xl border border-[var(--border)] bg-[var(--background)]">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--border)] pb-4 mb-4">
          <div>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Laptop className="w-5 h-5 text-[var(--primary)]" />
              {serviceName} Bulk Automation Dashboard
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--muted-foreground)] mt-1">
              Import and auto-login multiple accounts simultaneously with live browser streaming.
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
              agentConnected 
                ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" 
                : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
            }`}>
              <span className={`w-2 h-2 rounded-full ${agentConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              Windows Runner: {agentConnected ? "Online (Visible)" : "Offline (Server Headless)"}
            </div>
            <Badge variant={wsStatus === "open" ? "default" : "secondary"}>
              {wsStatus === "open" ? "WS Connected" : "WS Disconnected"}
            </Badge>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 overflow-y-auto mb-4">
          {!isRunning ? (
            /* Setup Phase Form */
            <div className="space-y-5 py-2 max-w-3xl mx-auto">
              {error && (
                <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--error)]/5 p-3.5 text-sm text-[var(--error)] flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Import Error</p>
                    <p className="text-xs mt-0.5">{error}</p>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-blue-500/10 bg-blue-500/5 p-4 text-xs text-blue-400 leading-relaxed flex gap-3">
                <Laptop className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-blue-300">Windows Runner Execution Mode</p>
                  <p className="mt-1">
                    When the Windows Local Runner is connected, browser sessions will physically open on your Windows desktop. This allows you to visually monitor the process and manually take over if Google requests verification, CAPTCHAs, or recovery emails.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium flex justify-between">
                  <span>Accounts List (email|password per line) <span className="text-red-500">*</span></span>
                  <span className="text-xs text-[var(--muted-foreground)]">Format: email|password atau email:password</span>
                </label>
                <Textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder="gmail1@gmail.com|password123&#10;gmail2@gmail.com|pass456"
                  className="min-h-[220px] font-mono text-sm border-[var(--border)] focus:ring-[var(--primary)]"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Browser Engine</label>
                  <select
                    value={browserEngine}
                    onChange={(e) => setBrowserEngine(e.target.value)}
                    className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  >
                    <option value="camoufox">Camoufox (Anti-detect, recommended)</option>
                    <option value="chromium">Chromium (Standard Playwright)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Concurrent Workers</label>
                  <select
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value))}
                    className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>{n} workers</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="headless-toggle"
                  checked={headless}
                  onChange={(e) => setHeadless(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
                />
                <label htmlFor="headless-toggle" className="text-sm font-medium cursor-pointer select-none">
                  Run browser completely headless (hidden window)
                </label>
              </div>
            </div>
          ) : (
            /* Running Phase Dashboard */
            <div className="space-y-5 h-full flex flex-col min-h-0">
              
              {/* Progress Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 shrink-0">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/10 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Total Accounts</p>
                  <p className="text-xl font-bold mt-1">{stats.total}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/10 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Manual Assist</p>
                  <p className="text-xl font-bold text-amber-500 mt-1 flex items-center gap-1.5">
                    {stats.manual}
                    {stats.manual > 0 && <Radio className="w-4 h-4 animate-pulse" />}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/10 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-400">Running</p>
                  <p className="text-xl font-bold text-blue-400 mt-1 flex items-center gap-1.5">
                    {stats.running}
                    {stats.running > 0 && <Loader2 className="w-4 h-4 animate-spin" />}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/10 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Queued</p>
                  <p className="text-xl font-bold mt-1">{stats.queued}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/10 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Success</p>
                  <p className="text-xl font-bold text-emerald-500 mt-1">{stats.success}</p>
                </div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--secondary)]/10 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-500">Failed</p>
                  <p className="text-xl font-bold text-red-500 mt-1">{stats.failed}</p>
                </div>
              </div>

              {/* Warnings/Success Notification Banner */}
              {stats.manual > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400 flex items-center gap-2 shrink-0 animate-pulse">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Some accounts require manual assistance. Check your Windows desktop to complete prompts/2FA.</span>
                </div>
              )}

              {stats.success === stats.total && stats.total > 0 && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-400 flex items-center gap-2 shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>All accounts processed successfully!</span>
                </div>
              )}

              {/* Main Interactive Grid */}
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-4 min-h-0">
                
                {/* Left Column: Live Preview & Account Progress Table */}
                <div className="flex flex-col gap-4 min-h-0">
                  
                  {/* Live Stream Panel */}
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] flex flex-col overflow-hidden shrink-0">
                    <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5 bg-[var(--secondary)]/25">
                      <div className="flex items-center gap-2">
                        <Tv className="w-4 h-4 text-[var(--primary)]" />
                        <span className="text-xs font-semibold">Live Browser Preview</span>
                        {activePreviewAccountId !== null && (
                          <Badge variant="outline" className="text-[10px] py-0 font-mono">
                            ID: {activePreviewAccountId}
                          </Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-[var(--muted-foreground)] block truncate max-w-[200px] font-mono">
                          {activePreviewEmail}
                        </span>
                      </div>
                    </div>

                    <div className="relative bg-zinc-950 aspect-[16/10] max-h-[300px] flex items-center justify-center overflow-hidden">
                      {previewImage ? (
                        <img
                          src={previewImage}
                          alt="Playwright browser live stream"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-center p-6 text-[var(--muted-foreground)]">
                          <Tv className="w-12 h-12 text-[var(--muted-foreground)]/40 mb-3" />
                          <p className="text-sm font-medium">No active browser screenshot</p>
                          <p className="text-xs text-[var(--muted-foreground)]/75 mt-1 max-w-md">
                            Select a running worker account below to track its live browser screen. Screenshots stream every 1.5 seconds.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Accounts Status List */}
                  <div className="flex-1 border border-[var(--border)] rounded-xl bg-[var(--card)] flex flex-col min-h-0 overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--secondary)]/15 flex items-center justify-between shrink-0">
                      <span className="text-xs font-semibold flex items-center gap-1.5">
                        <ListTodo className="w-4 h-4 text-[var(--primary)]" />
                        Accounts Progression ({accountsArray.length})
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)] min-h-0">
                      {accountsArray.map((acc) => {
                        const isSelected = activePreviewAccountId === acc.accountId;
                        
                        return (
                          <div
                            key={acc.email}
                            onClick={() => acc.accountId && setActivePreviewAccountId(acc.accountId)}
                            className={`p-3.5 transition-colors cursor-pointer flex items-center justify-between gap-3 text-xs ${
                              isSelected ? "bg-[var(--primary)]/5" : "hover:bg-[var(--secondary)]/20"
                            }`}
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold truncate text-[var(--foreground)]">{acc.email}</span>
                                {acc.accountId && (
                                  <span className="text-[10px] text-[var(--muted-foreground)] font-mono">
                                    #{acc.accountId}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                                <span className="capitalize font-semibold text-[var(--foreground)]">{acc.currentStep}:</span>
                                <span className="truncate">{acc.message}</span>
                              </div>
                              {acc.error && (
                                <p className="text-[10px] text-red-500 font-medium">{acc.error}</p>
                              )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <Badge
                                className="font-semibold uppercase text-[10px]"
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
                                {acc.status.replace("_", " ")}
                              </Badge>

                              {acc.status === "running" && acc.accountId && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="w-7 h-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (acc.accountId) handleStopAccount(acc.accountId, acc.email);
                                  }}
                                >
                                  <StopCircle className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Right Column: Combined Live Activity Log */}
                <div className="border border-[var(--border)] rounded-xl bg-[var(--card)] flex flex-col min-h-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--secondary)]/15 shrink-0">
                    <h3 className="text-xs font-semibold flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-500" />
                      Live Automation Log
                    </h3>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto space-y-3 font-mono text-[11px] min-h-0 bg-zinc-950 text-zinc-300">
                    {activityLog.length === 0 ? (
                      <p className="text-zinc-500 italic p-2">Waiting for automation updates...</p>
                    ) : (
                      activityLog.map((log) => (
                        <div key={log.id} className="border-b border-zinc-900 pb-2 last:border-0 last:pb-0">
                          <div className="flex justify-between items-start gap-2 text-zinc-400 text-[10px]">
                            <span className="text-zinc-500">
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </span>
                            <span className="font-semibold truncate max-w-[200px]" title={log.email}>
                              {log.email.split("@")[0]}
                            </span>
                          </div>
                          <p className="mt-1 text-zinc-200">
                            <span className="text-[var(--primary)] capitalize font-semibold mr-1">
                              [{log.step}]:
                            </span>
                            {log.message}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>

            </div>
          )}
        </div>

        {/* Footer controls */}
        <div className="border-t border-[var(--border)] pt-4 flex justify-between items-center gap-3 shrink-0">
          <div>
            {isRunning && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Processed: <span className="font-semibold text-[var(--foreground)]">{stats.success + stats.failed}</span> / {stats.total} accounts
              </p>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <>
                <Button variant="outline" onClick={onClose} disabled={importing}>
                  Cancel
                </Button>
                <Button onClick={handleStartImport} disabled={importing || !bulkText.trim()}>
                  {importing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Starting Workers...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Start Bulk Automation
                    </>
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    onSuccess?.();
                    onClose();
                  }}
                >
                  Close & Refresh
                </Button>
                {stats.success + stats.failed < stats.total && (
                  <Button
                    variant="destructive"
                    onClick={async () => {
                      if (confirm("Are you sure you want to stop all running workers?")) {
                        await fetch(`${window.location.origin.replace("1931", "1930")}/api/auth/stop-all`, {
                          method: "POST",
                          headers: {
                            "Authorization": `Bearer ${localStorage.getItem("api_key") || "pool-proxy-secret-key"}`,
                          }
                        });
                        setSuccessMsg("All workers stopped by user.");
                        onSuccess?.();
                      }
                    }}
                  >
                    <StopCircle className="w-4 h-4 mr-2" />
                    Stop All Workers
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
