import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Layers,
  Grid,
  Shield,
  Lock,
  Link as LinkIcon,
  Tv,
  Activity,
  Terminal,
  Plus,
  Trash2,
  Play,
  Square,
  RotateCw,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  X,
  PlusCircle,
  Cpu
} from "lucide-react";
import { fetchApi } from "@/lib/api";

interface StoreApp {
  id: string;
  name: string;
  description: string;
  icon: string;
  port: number;
  status: string; // running | stopped | not_installed | docker_missing
  installed: boolean;
  url: string | null;
}

interface CustomService {
  id: number;
  name: string;
  description: string | null;
  cwd: string;
  command: string;
  envVars: string | null; // JSON string
  status: string; // running | stopped | error
  resources?: {
    cpu: number;
    memory: number;
  };
}

export default function AppStore() {
  const [storeApps, setStoreApps] = useState<StoreApp[]>([]);
  const [customServicesList, setCustomServicesList] = useState<CustomService[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("store");

  // Form states for creating custom service
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCwd, setFormCwd] = useState("");
  const [formCmd, setFormCmd] = useState("");
  const [formEnv, setFormEnv] = useState<{ key: string; value: string }[]>([{ key: "", value: "" }]);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Log terminal states
  const [logsDialogOpen, setLogsDialogOpen] = useState(false);
  const [selectedService, setSelectedService] = useState<CustomService | null>(null);
  const [logsContent, setLogsContent] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Status message
  const [statusMessage, setStatusMessage] = useState("");

  const loadData = async (silent = false) => {
    try {
      if (!silent) setRefreshing(true);
      
      const storeRes = await fetchApi<StoreApp[]>("/api/apps/store");
      setStoreApps(storeRes);

      const customRes = await fetchApi<CustomService[]>("/api/apps/custom");
      setCustomServicesList(customRes);

      setLoading(false);
    } catch (err) {
      console.error("Failed to load Apps data:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(true), 3000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll logs terminal
  useEffect(() => {
    if (logsDialogOpen && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logsContent, logsDialogOpen]);

  // Fetch logs loop when logs dialog is open
  useEffect(() => {
    if (!logsDialogOpen || !selectedService) return;

    const fetchLogs = async () => {
      try {
        const res = await fetchApi<{ logs: string }>(`/api/apps/custom/${selectedService.id}/logs`);
        setLogsContent(res.logs || "No logs available.");
      } catch (err: any) {
        setLogsContent(`Failed to read logs: ${err.message}`);
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [logsDialogOpen, selectedService]);

  // Docker actions
  const handleDockerInstall = async (appId: string) => {
    try {
      setStatusMessage(`Installing/starting ${appId}...`);
      await fetchApi(`/api/apps/store/${appId}/install`, { method: "POST" });
      setStatusMessage(`Successfully started ${appId}`);
      loadData(true);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  const handleDockerControl = async (appId: string, action: "start" | "stop") => {
    try {
      setStatusMessage(`${action === "start" ? "Starting" : "Stopping"} ${appId}...`);
      await fetchApi(`/api/apps/store/${appId}/control`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      setStatusMessage(`Container ${appId} ${action}ed`);
      loadData(true);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  const handleDockerUninstall = async (appId: string) => {
    if (!confirm(`Are you sure you want to uninstall and delete container '${appId}'?`)) return;
    try {
      setStatusMessage(`Uninstalling ${appId}...`);
      await fetchApi(`/api/apps/store/${appId}/uninstall`, { method: "DELETE" });
      setStatusMessage(`Container ${appId} uninstalled`);
      loadData(true);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  // Custom Service actions
  const handleCustomControl = async (id: number, action: "start" | "stop" | "restart") => {
    try {
      setStatusMessage(`${action === "start" ? "Starting" : action === "stop" ? "Stopping" : "Restarting"} service...`);
      await fetchApi(`/api/apps/custom/${id}/control`, {
        method: "POST",
        body: JSON.stringify({ action })
      });
      setStatusMessage(`Service command completed successfully`);
      loadData(true);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  const handleCustomDelete = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to stop, disable, and delete the systemd service '${name}'?`)) return;
    try {
      setStatusMessage(`Deleting service ${name}...`);
      await fetchApi(`/api/apps/custom/${id}`, { method: "DELETE" });
      setStatusMessage(`Service ${name} deleted successfully`);
      loadData(true);
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  // Create custom service submission
  const handleCreateCustomService = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!formName.trim() || !formCwd.trim() || !formCmd.trim()) {
      setFormError("Service Name, Working Directory, and Start Command are required.");
      return;
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(formName)) {
      setFormError("Service Name can only contain alphanumeric characters, dashes, and underscores.");
      return;
    }

    // Convert env vars list to record
    const envVarsRecord: Record<string, string> = {};
    for (const item of formEnv) {
      if (item.key.trim() && item.value.trim()) {
        envVarsRecord[item.key.trim()] = item.value.trim();
      }
    }

    setSubmitting(true);
    try {
      await fetchApi("/api/apps/custom", {
        method: "POST",
        body: JSON.stringify({
          name: formName,
          description: formDesc || undefined,
          cwd: formCwd,
          command: formCmd,
          envVars: Object.keys(envVarsRecord).length > 0 ? envVarsRecord : undefined
        })
      });
      
      // Reset form
      setFormName("");
      setFormDesc("");
      setFormCwd("");
      setFormCmd("");
      setFormEnv([{ key: "", value: "" }]);
      setAddDialogOpen(false);
      setStatusMessage("Successfully created custom systemd service!");
      loadData(true);
    } catch (err: any) {
      setFormError(err.message || "Failed to create service.");
    } finally {
      setSubmitting(false);
    }
  };

  // Env vars helper rows
  const handleAddEnvRow = () => {
    setFormEnv([...formEnv, { key: "", value: "" }]);
  };

  const handleRemoveEnvRow = (idx: number) => {
    const next = [...formEnv];
    next.splice(idx, 1);
    setFormEnv(next.length === 0 ? [{ key: "", value: "" }] : next);
  };

  const handleEnvChange = (idx: number, field: "key" | "value", text: string) => {
    const next = [...formEnv];
    next[idx][field] = text;
    setFormEnv(next);
  };

  // Icon Helper mapping
  const renderAppIcon = (iconName: string) => {
    const iconClass = "w-8 h-8 text-[var(--primary)]";
    switch (iconName) {
      case "Shield": return <Shield className={iconClass} />;
      case "Lock": return <Lock className={iconClass} />;
      case "Link": return <LinkIcon className={iconClass} />;
      case "Tv": return <Tv className={iconClass} />;
      case "Grid": return <Grid className={iconClass} />;
      default: return <Layers className={iconClass} />;
    }
  };

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge variant="success" className="animate-pulse">Active</Badge>;
      case "stopped":
        return <Badge variant="warning">Stopped</Badge>;
      case "docker_missing":
        return <Badge variant="error">Docker Missing</Badge>;
      case "error":
        return <Badge variant="error">Error</Badge>;
      default:
        return <Badge variant="outline" className="text-zinc-500 border-zinc-700">Not Installed</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-[var(--primary)] animate-spin" />
        <span className="text-sm text-[var(--muted-foreground)]">Loading App Store & Manager...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">App Store & Manager</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Deploy Docker-based server tools or register your own custom web/bot systemd services
          </p>
        </div>
        <div className="flex items-center gap-4">
          {statusMessage && (
            <span className="text-xxs font-mono bg-zinc-800/80 border border-zinc-700/50 px-2.5 py-1 rounded text-[var(--primary)] max-w-xs truncate">
              {statusMessage}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData()}
            disabled={refreshing}
            className="h-8 gap-1.5 cursor-pointer text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-sm">
          <TabsTrigger value="store" className="flex items-center gap-2">
            <Layers className="w-4 h-4" /> Docker App Store
          </TabsTrigger>
          <TabsTrigger value="custom" className="flex items-center gap-2">
            <Terminal className="w-4 h-4" /> Custom Scripts & Bots
          </TabsTrigger>
        </TabsList>

        {/* ────────── DOCKER APP STORE TAB ────────── */}
        <TabsContent value="store" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {storeApps.map((app) => (
              <Card key={app.id} className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md flex flex-col justify-between hover:border-[var(--primary)]/30 transition-all">
                <CardHeader className="flex flex-row items-start justify-between pb-3">
                  <div className="flex items-center gap-3.5">
                    <div className="p-2.5 bg-[var(--secondary)]/50 rounded-xl border border-[var(--border)]">
                      {renderAppIcon(app.icon)}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-[var(--foreground)]">{app.name}</h3>
                      <p className="text-[10px] text-[var(--muted-foreground)] font-mono mt-0.5">
                        {app.port ? `Port ${app.port}` : "Host Network"}
                      </p>
                    </div>
                  </div>
                  {renderStatusBadge(app.status)}
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                  <p className="text-xs text-[var(--muted-foreground)] leading-relaxed min-h-[48px]">
                    {app.description}
                  </p>

                  <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]/30">
                    {!app.installed ? (
                      <Button
                        onClick={() => handleDockerInstall(app.id)}
                        className="w-full text-xs font-semibold cursor-pointer"
                        size="sm"
                        disabled={app.status === "docker_missing"}
                      >
                        Install App
                      </Button>
                    ) : (
                      <>
                        {app.status === "running" ? (
                          <>
                            <Button
                              onClick={() => handleDockerControl(app.id, "stop")}
                              variant="outline"
                              className="flex-1 text-xs border-[var(--warning)]/30 bg-[var(--warning)]/5 text-[var(--warning)] hover:bg-[var(--warning)]/10 cursor-pointer"
                              size="sm"
                            >
                              <Square className="w-3.5 h-3.5 mr-1" /> Stop
                            </Button>
                            {app.url && (
                              <a
                                href={app.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1"
                              >
                                <Button
                                  variant="secondary"
                                  className="w-full text-xs cursor-pointer"
                                  size="sm"
                                >
                                  Open UI <ExternalLink className="w-3 h-3 ml-1" />
                                </Button>
                              </a>
                            )}
                          </>
                        ) : (
                          <Button
                            onClick={() => handleDockerControl(app.id, "start")}
                            className="flex-1 text-xs bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20 hover:bg-[var(--success)]/15 cursor-pointer"
                            size="sm"
                          >
                            <Play className="w-3.5 h-3.5 mr-1" fill="currentColor" /> Start
                          </Button>
                        )}
                        <Button
                          onClick={() => handleDockerUninstall(app.id)}
                          variant="outline"
                          size="sm"
                          className="px-2.5 text-xs text-[var(--error)] border-[var(--error)]/30 bg-[var(--error)]/5 hover:bg-[var(--error)]/10 cursor-pointer"
                          title="Uninstall"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ────────── CUSTOM SERVICES TAB ────────── */}
        <TabsContent value="custom" className="space-y-6">
          <div className="flex justify-between items-center bg-[var(--secondary)]/20 p-4 rounded-xl border border-[var(--border)]">
            <div className="text-xs text-[var(--muted-foreground)] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--primary)]" />
              <span>
                Register local node/python scripts from your SD card as background services managed by Linux <code>systemd</code>.
              </span>
            </div>
            <Button
              onClick={() => setAddDialogOpen(true)}
              className="text-xs font-semibold gap-1.5 cursor-pointer h-9"
            >
              <Plus className="w-4 h-4" /> Add Custom Bot/Script
            </Button>
          </div>

          {customServicesList.length === 0 ? (
            <div className="text-xs text-[var(--muted-foreground)] flex flex-col items-center justify-center h-48 border border-dashed border-[var(--border)] rounded-xl gap-2">
              <Terminal className="w-8 h-8 text-[var(--muted-foreground)] opacity-40" />
              <span>No custom services registered yet. Click the button above to add one.</span>
            </div>
          ) : (
            <div className="space-y-4">
              {customServicesList.map((service) => (
                <div
                  key={service.id}
                  className="p-4 rounded-xl border border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2.5">
                      <span className="font-bold text-sm text-[var(--foreground)] font-mono">
                        {service.name}.service
                      </span>
                      {renderStatusBadge(service.status)}
                    </div>
                    {service.description && (
                      <p className="text-xs text-[var(--muted-foreground)]">{service.description}</p>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-[10px] text-[var(--muted-foreground)] font-mono">
                      <div className="truncate">Cwd: <span className="text-zinc-400">{service.cwd}</span></div>
                      <div className="truncate">Cmd: <span className="text-zinc-400">{service.command}</span></div>
                    </div>
                  </div>

                  {/* Resource Usage indicators */}
                  {service.status === "running" && service.resources && (
                    <div className="flex items-center gap-4 px-4 py-2 bg-[var(--secondary)]/30 rounded-lg border border-[var(--border)]/50 shrink-0 font-mono text-[10px]">
                      <div className="flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-[var(--primary)]" />
                        <span>CPU: <span className="font-bold text-white">{service.resources.cpu}%</span></span>
                      </div>
                      <div className="w-px h-4 bg-[var(--border)]" />
                      <div className="flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-[var(--success)]" />
                        <span>RAM: <span className="font-bold text-white">{service.resources.memory} MB</span></span>
                      </div>
                    </div>
                  )}

                  {/* Service actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {service.status === "running" ? (
                      <Button
                        onClick={() => handleCustomControl(service.id, "stop")}
                        variant="outline"
                        size="sm"
                        className="text-xs text-[var(--warning)] border-[var(--warning)]/30 bg-[var(--warning)]/5 hover:bg-[var(--warning)]/10 cursor-pointer h-8"
                      >
                        <Square className="w-3.5 h-3.5 mr-1" /> Stop
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleCustomControl(service.id, "start")}
                        variant="outline"
                        size="sm"
                        className="text-xs text-[var(--success)] border-[var(--success)]/30 bg-[var(--success)]/5 hover:bg-[var(--success)]/10 cursor-pointer h-8"
                      >
                        <Play className="w-3.5 h-3.5 mr-1" fill="currentColor" /> Start
                      </Button>
                    )}
                    
                    <Button
                      onClick={() => handleCustomControl(service.id, "restart")}
                      variant="outline"
                      size="sm"
                      className="text-xs text-zinc-400 border-zinc-700 bg-zinc-800/20 hover:bg-zinc-800/40 cursor-pointer h-8"
                      title="Restart Service"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </Button>

                    <Button
                      onClick={() => {
                        setSelectedService(service);
                        setLogsContent("Connecting to journalctl logs...");
                        setLogsDialogOpen(true);
                      }}
                      variant="secondary"
                      size="sm"
                      className="text-xs cursor-pointer h-8"
                    >
                      <Terminal className="w-3.5 h-3.5 mr-1" /> Logs
                    </Button>

                    <Button
                      onClick={() => handleCustomDelete(service.id, service.name)}
                      variant="outline"
                      size="sm"
                      className="text-xs text-[var(--error)] border-[var(--error)]/30 bg-[var(--error)]/5 hover:bg-[var(--error)]/10 cursor-pointer h-8 px-2.5"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ────────── REGISTRATION MODAL DIALOG ────────── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto border-[var(--border)] bg-[var(--card)]/95 backdrop-blur-xl text-[var(--foreground)]">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-[var(--primary)]" />
              Register Custom systemd Service
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--muted-foreground)]">
              This will automatically generate a systemd daemon script on your Armbian host.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateCustomService} className="space-y-4 pt-2">
            {formError && (
              <div className="p-3 rounded-lg bg-[var(--error)]/10 border border-[var(--error)]/25 text-[var(--error)] text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xxs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Service Name (No spaces)</label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                  placeholder="e.g. tele-bot-cuan"
                  className="h-9 font-mono text-xs"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xxs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Description</label>
                <Input
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="e.g. Telegram Channel bot scraper"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xxs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Working Directory (CWD - Absolute Path)</label>
              <Input
                value={formCwd}
                onChange={(e) => setFormCwd(e.target.value)}
                placeholder="e.g. /mnt/intip_sdcard/my-telegram-bot"
                className="h-9 font-mono text-xs"
                required
              />
              <p className="text-[9px] text-[var(--muted-foreground)] mt-0.5">
                Path folder root proyek Anda di SD Card eksternal.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xxs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Execution Command</label>
              <Input
                value={formCmd}
                onChange={(e) => setFormCmd(e.target.value)}
                placeholder="e.g. bun run index.ts or python3 main.py"
                className="h-9 font-mono text-xs"
                required
              />
              <p className="text-[9px] text-[var(--muted-foreground)] mt-0.5">
                Perintah yang dijalankan untuk menyalakan script Anda.
              </p>
            </div>

            {/* Env variables editor */}
            <div className="space-y-2 border-t border-[var(--border)]/30 pt-3">
              <div className="flex justify-between items-center">
                <label className="text-xxs font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Environment Variables (.env)</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddEnvRow}
                  className="h-7 text-xxs gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" /> Add Row
                </Button>
              </div>

              <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                {formEnv.map((env, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={env.key}
                      onChange={(e) => handleEnvChange(idx, "key", e.target.value.toUpperCase().replace(/\s+/g, "_"))}
                      placeholder="KEY (e.g. DISCORD_TOKEN)"
                      className="h-8 font-mono text-[10px] flex-1"
                    />
                    <Input
                      value={env.value}
                      onChange={(e) => handleEnvChange(idx, "value", e.target.value)}
                      placeholder="Value"
                      className="h-8 font-mono text-[10px] flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleRemoveEnvRow(idx)}
                      className="h-8 px-2 text-[var(--error)] border-zinc-700 hover:bg-[var(--error)]/10 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-[var(--border)]/30">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddDialogOpen(false)}
                className="h-9 text-xs cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="h-9 text-xs font-semibold cursor-pointer"
              >
                {submitting ? "Creating..." : "Create & Start Service"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ────────── LIVE LOGS MODAL DIALOG ────────── */}
      <Dialog open={logsDialogOpen} onOpenChange={setLogsDialogOpen}>
        <DialogContent className="max-w-2xl border-[var(--border)] bg-zinc-950 text-white max-h-[85vh] flex flex-col justify-between">
          <DialogHeader className="border-b border-zinc-800 pb-3">
            <DialogTitle className="text-sm font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[var(--primary)]" />
              Live Output Logs: {selectedService?.name}.service
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 font-mono text-xxs bg-black rounded-lg border border-zinc-900 h-96 min-h-[360px] leading-relaxed whitespace-pre-wrap select-text scrollbar-thin scrollbar-thumb-zinc-800 flex flex-col justify-start">
            <div className="flex-1">
              {logsContent}
              <div ref={logsEndRef} />
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-zinc-800 gap-3">
            <Button
              variant="outline"
              onClick={() => setLogsDialogOpen(false)}
              className="border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 cursor-pointer text-xs h-8"
            >
              Close Console
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
