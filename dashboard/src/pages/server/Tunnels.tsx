import { useState, useEffect } from "react";
import { fetchApi, fetchSettings, updateSettings } from "@/lib/api";
import {
  Cloud,
  Shield,
  Plus,
  Trash2,
  Terminal,
  Settings,
  RefreshCw,
  Play,
  Square,
  ExternalLink,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Tunnel {
  id: string;
  name: string;
  status: "active" | "inactive" | "error";
  createdAt: string;
  updatedAt: string;
}

interface IngressRule {
  id: number;
  tunnelId: string;
  hostname: string;
  service: string;
  dnsRecordId: string | null;
  createdAt: string;
}

export default function Tunnels() {
  // Cloudflare API settings state
  const [apiToken, setApiToken] = useState("");
  const [accountId, setAccountId] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSuccess, setSettingsSuccess] = useState(false);

  // Status and installation state
  const [status, setStatus] = useState({ installed: false, isInstalling: false, installError: null as string | null });
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [loadingTunnels, setLoadingTunnels] = useState(true);

  // Modals state
  const [activeTunnel, setActiveTunnel] = useState<Tunnel | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTunnelName, setNewTunnelName] = useState("");
  const [creatingTunnel, setCreatingTunnel] = useState(false);
  const [createError, setCreateError] = useState("");

  // Rules Modal state
  const [showRulesModal, setShowRulesModal] = useState(false);
  const [rules, setRules] = useState<IngressRule[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [newRuleHostname, setNewRuleHostname] = useState("");
  const [selectedServiceType, setSelectedServiceType] = useState("http://localhost:1931");
  const [customServiceAddress, setCustomServiceAddress] = useState("http://localhost:");
  const [addingRule, setAddingRule] = useState(false);
  const [ruleError, setRuleError] = useState("");

  // Logs Modal state
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logsText, setLogsText] = useState("");
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Load Cloudflare API settings & installer status
  const loadInitialData = async () => {
    try {
      const res = await fetchSettings();
      const settingsData = res.data || {};
      setApiToken(settingsData.cloudflare_api_token || "");
      setAccountId(settingsData.cloudflare_account_id || "");

      // Get installer status
      const statusRes = await fetchApi("/api/tunnels/status");
      setStatus(statusRes);

      // Get tunnels list
      await loadTunnels();
    } catch (err) {
      console.error("Failed to load initial tunnels data:", err);
    }
  };

  const loadTunnels = async () => {
    try {
      setLoadingTunnels(true);
      const res = await fetchApi("/api/tunnels");
      setTunnels(res.data || []);
    } catch (err) {
      console.error("Failed to load tunnels list:", err);
    } finally {
      setLoadingTunnels(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Poll status while installing
  useEffect(() => {
    let interval: any = null;
    if (status.isInstalling) {
      interval = setInterval(async () => {
        try {
          const res = await fetchApi("/api/tunnels/status");
          setStatus(res);
          if (res.installed && !res.isInstalling) {
            if (interval) clearInterval(interval);
          }
        } catch (err) {
          console.error("Failed polling status:", err);
        }
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status.isInstalling]);

  // Handle saving settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSaving(true);
    setSettingsSuccess(false);
    try {
      await updateSettings({
        cloudflare_api_token: apiToken,
        cloudflare_account_id: accountId,
      });
      setSettingsSuccess(true);
      setTimeout(() => setSettingsSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSettingsSaving(false);
    }
  };

  // Handle triggering installation
  const handleInstall = async () => {
    try {
      setStatus((prev) => ({ ...prev, isInstalling: true, installError: null }));
      await fetchApi("/api/tunnels/install", { method: "POST" });
    } catch (err: any) {
      setStatus((prev) => ({ ...prev, isInstalling: false, installError: err.message }));
    }
  };

  // Create new tunnel
  const handleCreateTunnel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTunnelName.trim()) return;

    setCreatingTunnel(true);
    setCreateError("");
    try {
      await fetchApi("/api/tunnels", {
        method: "POST",
        body: JSON.stringify({ name: newTunnelName.trim() }),
      });
      setNewTunnelName("");
      setShowCreateModal(false);
      await loadTunnels();
    } catch (err: any) {
      setCreateError(err.message || "Failed to create tunnel");
    } finally {
      setCreatingTunnel(false);
    }
  };

  // Delete tunnel
  const handleDeleteTunnel = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete tunnel "${name}"? This will also remove all associated local Ingress Rules and Cloudflare DNS CNAME records.`)) return;

    try {
      await fetchApi(`/api/tunnels/${id}`, { method: "DELETE" });
      await loadTunnels();
    } catch (err) {
      console.error("Failed to delete tunnel:", err);
    }
  };

  // Control service (Start/Stop/Restart)
  const handleControlTunnel = async (id: string, action: "start" | "stop" | "restart") => {
    try {
      await fetchApi(`/api/tunnels/${id}/control`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      // Small delay for systemd status to transition
      setTimeout(loadTunnels, 800);
    } catch (err) {
      console.error(`Failed to ${action} tunnel:`, err);
    }
  };

  // Load Ingress Rules
  const handleOpenRules = async (tunnel: Tunnel) => {
    setActiveTunnel(tunnel);
    setShowRulesModal(true);
    setLoadingRules(true);
    setRuleError("");
    try {
      const res = await fetchApi(`/api/tunnels/${tunnel.id}/rules`);
      setRules(res.data || []);
    } catch (err) {
      console.error("Failed to load rules:", err);
    } finally {
      setLoadingRules(false);
    }
  };

  // Add Ingress Rule
  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleHostname.trim() || !activeTunnel) return;

    const finalService = selectedServiceType === "custom" ? customServiceAddress.trim() : selectedServiceType;
    if (!finalService) return;

    setAddingRule(true);
    setRuleError("");
    try {
      await fetchApi(`/api/tunnels/${activeTunnel.id}/rules`, {
        method: "POST",
        body: JSON.stringify({
          hostname: newRuleHostname.trim(),
          service: finalService,
        }),
      });
      setNewRuleHostname("");
      // Reload rules
      const res = await fetchApi(`/api/tunnels/${activeTunnel.id}/rules`);
      setRules(res.data || []);
    } catch (err: any) {
      setRuleError(err.message || "Failed to add ingress rule");
    } finally {
      setAddingRule(false);
    }
  };

  // Delete Ingress Rule
  const handleDeleteRule = async (ruleId: number) => {
    if (!activeTunnel) return;
    try {
      await fetchApi(`/api/tunnels/${activeTunnel.id}/rules/${ruleId}`, { method: "DELETE" });
      // Reload rules
      const res = await fetchApi(`/api/tunnels/${activeTunnel.id}/rules`);
      setRules(res.data || []);
    } catch (err) {
      console.error("Failed to delete rule:", err);
    }
  };

  // Load and View Logs
  const handleOpenLogs = async (tunnel: Tunnel) => {
    setActiveTunnel(tunnel);
    setShowLogsModal(true);
    setLoadingLogs(true);
    try {
      const res = await fetchApi(`/api/tunnels/${tunnel.id}/logs`);
      setLogsText(res.logs || "No logs available.");
    } catch (err) {
      console.error("Failed to fetch logs:", err);
      setLogsText("Failed to retrieve service logs.");
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleRefreshLogs = async () => {
    if (!activeTunnel) return;
    setLoadingLogs(true);
    try {
      const res = await fetchApi(`/api/tunnels/${activeTunnel.id}/logs`);
      setLogsText(res.logs || "No logs available.");
    } catch (err) {
      console.error("Failed to refresh logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] flex items-center gap-2">
            <Cloud className="w-7 h-7 text-[var(--primary)]" />
            Cloudflare Zero Trust & Tunnels
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Expose local dashboard, media servers, and other services to the public internet securely without opening ports.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Side: Daemon & API configs */}
        <div className="space-y-6 lg:col-span-1">
          {/* Daemon Status Card */}
          <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
                <Shield className="w-4 h-4 text-[var(--primary)]" />
                Installer Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--secondary)]/30 border border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full ${status.installed ? "bg-[var(--success)] animate-pulse" : "bg-[var(--destructive)]"}`} />
                  <span className="text-xs font-semibold text-[var(--foreground)]">cloudflared daemon</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase font-mono ${status.installed ? "bg-[var(--success)]/10 text-[var(--success)]" : "bg-[var(--destructive)]/10 text-[var(--destructive)]"}`}>
                  {status.installed ? "Installed" : "Missing"}
                </span>
              </div>

              {!status.installed && !status.isInstalling && (
                <div className="p-3 bg-[var(--destructive)]/5 border border-[var(--destructive)]/20 rounded-xl space-y-3">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    The Cloudflare Tunnel CLI daemon (`cloudflared`) was not detected on this system. You must install it to manage tunnels.
                  </p>
                  <Button onClick={handleInstall} className="w-full text-xs py-1.5 h-auto bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90">
                    1-Click Auto Install
                  </Button>
                </div>
              )}

              {status.isInstalling && (
                <div className="p-4 bg-[var(--secondary)]/20 rounded-xl flex flex-col items-center justify-center gap-2.5 text-center">
                  <Loader2 className="w-7 h-7 text-[var(--primary)] animate-spin" />
                  <div className="text-xs font-medium text-[var(--foreground)]">Installing cloudflared daemon...</div>
                  <div className="text-[10px] text-[var(--muted-foreground)]">Adding Cloudflare repository and installing package. Please wait...</div>
                </div>
              )}

              {status.installError && (
                <div className="p-3 bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 rounded-xl flex items-start gap-2 text-[var(--destructive)]">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="text-xs font-medium break-all">{status.installError}</div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cloudflare API Credentials */}
          <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)] flex items-center gap-2">
                <Settings className="w-4 h-4 text-[var(--success)]" />
                Cloudflare API Credentials
              </CardTitle>
              <CardDescription className="text-xxs">
                API token must have <strong>Zone.DNS (Edit)</strong> and <strong>Account.Cloudflare Tunnel (Edit)</strong> permissions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveSettings} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] tracking-wider">Cloudflare API Token</label>
                  <Input
                    type="password"
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                    placeholder="cf_token_..."
                    className="h-9 text-xs bg-[var(--secondary)]/20 border-[var(--border)] focus:border-[var(--primary)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] tracking-wider">Cloudflare Account ID</label>
                  <Input
                    type="text"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    placeholder="account_id_hex_string"
                    className="h-9 text-xs bg-[var(--secondary)]/20 border-[var(--border)] focus:border-[var(--primary)]"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Button type="submit" disabled={settingsSaving} className="flex-1 text-xs py-1.5 h-auto bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90">
                    {settingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save API Settings"}
                  </Button>
                  {settingsSuccess && (
                    <span className="flex items-center gap-1.5 text-xs text-[var(--success)]">
                      <CheckCircle2 className="w-4 h-4" />
                      Saved
                    </span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Tunnels List & CRUD */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="border-[var(--border)] bg-[var(--card)]/40 backdrop-blur-md h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Cloudflare Tunnels
                </CardTitle>
                <CardDescription className="text-xs">
                  Daemon systemd services active on this host
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingTunnels}
                  onClick={loadTunnels}
                  className="text-xs h-8 px-3 flex items-center gap-1 border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--secondary)]/50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingTunnels ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button
                  disabled={!status.installed || !apiToken || !accountId}
                  onClick={() => {
                    setNewTunnelName("");
                    setCreateError("");
                    setShowCreateModal(true);
                  }}
                  className="text-xs h-8 px-3 flex items-center gap-1 bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Tunnel
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingTunnels ? (
                <div className="flex items-center justify-center py-16 gap-2 text-sm text-[var(--muted-foreground)]">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--primary)]" />
                  Loading tunnels...
                </div>
              ) : tunnels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-2 text-[var(--muted-foreground)] border border-dashed border-[var(--border)] rounded-2xl">
                  <Cloud className="w-10 h-10 text-[var(--muted-foreground)]/40" />
                  <div className="text-sm font-medium">No tunnels configured</div>
                  <p className="text-xs max-w-xs">
                    Configure your API token and create your first Cloudflare Tunnel to expose local ports.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {tunnels.map((t) => (
                    <div
                      key={t.id}
                      className="p-4 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/10 hover:bg-[var(--secondary)]/20 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${t.status === "active" ? "bg-[var(--success)] animate-pulse" : "bg-[var(--muted)]"}`} />
                          <span className="font-bold text-sm text-[var(--foreground)] truncate">{t.name}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono uppercase font-bold ${t.status === "active" ? "bg-[var(--success)]/10 text-[var(--success)]" : "bg-[var(--muted)]/15 text-[var(--muted-foreground)]"}`}>
                            {t.status}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-[var(--muted-foreground)] select-all break-all">{t.id}</div>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Control buttons */}
                        {t.status === "active" ? (
                          <Button
                            onClick={() => handleControlTunnel(t.id, "stop")}
                            title="Stop Tunnel"
                            className="w-8 h-8 p-0 bg-transparent text-[var(--muted-foreground)] border border-[var(--border)] hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]"
                          >
                            <Square className="w-3.5 h-3.5 fill-current" />
                          </Button>
                        ) : (
                          <Button
                            onClick={() => handleControlTunnel(t.id, "start")}
                            title="Start Tunnel"
                            className="w-8 h-8 p-0 bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                          </Button>
                        )}

                        <Button
                          onClick={() => handleControlTunnel(t.id, "restart")}
                          title="Restart Tunnel"
                          className="w-8 h-8 p-0 bg-transparent text-[var(--muted-foreground)] border border-[var(--border)] hover:bg-[var(--secondary)]/50"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>

                        {/* Rules configurations */}
                        <Button
                          onClick={() => handleOpenRules(t)}
                          className="text-xs h-8 px-2.5 bg-transparent text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--secondary)]/50 flex items-center gap-1"
                        >
                          <Settings className="w-3.5 h-3.5" />
                          Rules
                        </Button>

                        {/* Logs */}
                        <Button
                          onClick={() => handleOpenLogs(t)}
                          className="text-xs h-8 px-2.5 bg-transparent text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--secondary)]/50 flex items-center gap-1"
                        >
                          <Terminal className="w-3.5 h-3.5" />
                          Logs
                        </Button>

                        {/* Delete */}
                        <Button
                          onClick={() => handleDeleteTunnel(t.id, t.name)}
                          className="w-8 h-8 p-0 bg-transparent text-[var(--destructive)] border border-[var(--border)] hover:bg-[var(--destructive)]/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* CREATE TUNNEL MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--card)] border border-[var(--border)] w-full max-w-md rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wider flex items-center gap-2">
                <Cloud className="w-4 h-4 text-[var(--primary)]" />
                Create New Tunnel
              </h2>
              <button onClick={() => setShowCreateModal(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateTunnel}>
              <div className="p-5 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] tracking-wider">Tunnel Name</label>
                  <Input
                    type="text"
                    required
                    value={newTunnelName}
                    onChange={(e) => setNewTunnelName(e.target.value.replace(/[^a-zA-Z0-9-]/g, ""))}
                    placeholder="e.g. armbian-stb-tunnel"
                    className="h-10 text-xs bg-[var(--secondary)]/20 border-[var(--border)] focus:border-[var(--primary)]"
                  />
                  <p className="text-[9px] text-[var(--muted-foreground)]">Only alphanumeric characters and hyphens are allowed.</p>
                </div>

                {createError && (
                  <div className="p-3 rounded-xl bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 text-[var(--destructive)] text-xs font-medium">
                    {createError}
                  </div>
                )}
              </div>
              <div className="p-5 bg-[var(--secondary)]/10 border-t border-[var(--border)] flex items-center justify-end gap-2">
                <Button type="button" onClick={() => setShowCreateModal(false)} className="text-xs h-9 px-4 bg-transparent text-[var(--muted-foreground)] border border-[var(--border)] hover:bg-[var(--secondary)]/50">
                  Cancel
                </Button>
                <Button type="submit" disabled={creatingTunnel} className="text-xs h-9 px-4 bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90">
                  {creatingTunnel ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create Tunnel"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INGRESS RULES CONFIGURATOR MODAL */}
      {showRulesModal && activeTunnel && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--card)] border border-[var(--border)] w-full max-w-2xl rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wider">
                  Configure Routing Rules
                </h2>
                <p className="text-xxs text-[var(--muted-foreground)] mt-0.5">
                  Tunnel: <span className="font-mono">{activeTunnel.name} ({activeTunnel.id})</span>
                </p>
              </div>
              <button onClick={() => setShowRulesModal(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-6 max-h-[70vh] overflow-y-auto">
              {/* Form to add a rule */}
              <form onSubmit={handleAddRule} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--secondary)]/10 space-y-4">
                <div className="text-xs font-bold text-[var(--foreground)] uppercase tracking-wider">Add Subdomain Router Rule</div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] tracking-wider">Public Hostname / Domain</label>
                    <Input
                      type="text"
                      required
                      value={newRuleHostname}
                      onChange={(e) => setNewRuleHostname(e.target.value)}
                      placeholder="e.g. dash.domain.com"
                      className="h-9 text-xs bg-[var(--secondary)]/20 border-[var(--border)]"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] tracking-wider">Local Port / Service Mapping</label>
                    <select
                      value={selectedServiceType}
                      onChange={(e) => setSelectedServiceType(e.target.value)}
                      className="w-full h-9 px-3 text-xs bg-[var(--secondary)]/20 border border-[var(--border)] rounded-md text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
                    >
                      <option value="http://localhost:1931">Etteum Dashboard (Port 1931)</option>
                      <option value="http://localhost:1930">Etteum Hono Core (Port 1930)</option>
                      <option value="http://localhost:8080">Pi-hole Adblocker (Port 8080)</option>
                      <option value="http://localhost:8081">Vaultwarden Manager (Port 8081)</option>
                      <option value="http://localhost:8096">Jellyfin Media Server (Port 8096)</option>
                      <option value="http://localhost:3000">Homepage Portal (Port 3000)</option>
                      <option value="custom">Custom Port/Address...</option>
                    </select>
                  </div>
                </div>

                {selectedServiceType === "custom" && (
                  <div className="space-y-1 animate-in slide-in-from-top-2 duration-200">
                    <label className="text-[10px] uppercase font-bold text-[var(--muted-foreground)] tracking-wider">Custom Local Address</label>
                    <Input
                      type="text"
                      required
                      value={customServiceAddress}
                      onChange={(e) => setCustomServiceAddress(e.target.value)}
                      placeholder="e.g. http://localhost:9000 or http://192.168.1.100:80"
                      className="h-9 text-xs bg-[var(--secondary)]/20 border-[var(--border)]"
                    />
                  </div>
                )}

                {ruleError && (
                  <div className="p-2.5 rounded-lg bg-[var(--destructive)]/10 border border-[var(--destructive)]/20 text-[var(--destructive)] text-xs">
                    {ruleError}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button type="submit" disabled={addingRule} className="text-xs h-8 px-4 bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90">
                    {addingRule ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Deploy & Add Rule"}
                  </Button>
                </div>
              </form>

              {/* Active Rules List */}
              <div className="space-y-3">
                <div className="text-xs font-bold text-[var(--foreground)] uppercase tracking-wider flex items-center gap-1">
                  <span>Active Routing Paths</span>
                  <span className="text-[10px] font-mono text-[var(--muted-foreground)]">({rules.length})</span>
                </div>

                {loadingRules ? (
                  <div className="text-xs text-[var(--muted-foreground)] py-6 text-center">Loading rules list...</div>
                ) : rules.length === 0 ? (
                  <div className="text-xs text-[var(--muted-foreground)] py-6 text-center border border-dashed border-[var(--border)] rounded-xl">
                    No active routing rules configured for this tunnel.
                  </div>
                ) : (
                  <div className="border border-[var(--border)] rounded-xl divide-y divide-[var(--border)] overflow-hidden">
                    {rules.map((r) => (
                      <div key={r.id} className="p-3 bg-[var(--secondary)]/10 flex items-center justify-between gap-4 hover:bg-[var(--secondary)]/20 transition-all">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-[var(--foreground)] truncate select-all">{r.hostname}</span>
                            <a href={`https://${r.hostname}`} target="_blank" rel="noopener noreferrer" className="text-[var(--primary)] hover:underline">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="text-[10px] text-[var(--muted-foreground)] font-mono truncate">
                            maps to: <span className="text-[var(--foreground)]">{r.service}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {r.dnsRecordId && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[var(--success)]/10 text-[var(--success)] flex items-center gap-1">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              DNS Synced
                            </span>
                          )}
                          <Button
                            onClick={() => handleDeleteRule(r.id)}
                            className="w-7 h-7 p-0 bg-transparent text-[var(--destructive)] border border-[var(--border)] hover:bg-[var(--destructive)]/10"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-5 bg-[var(--secondary)]/10 border-t border-[var(--border)] flex items-center justify-end">
              <Button type="button" onClick={() => setShowRulesModal(false)} className="text-xs h-9 px-4 bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90">
                Close Configurations
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* SYSTEMD JOURNAL LOGS MODAL */}
      {showLogsModal && activeTunnel && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--card)] border border-[var(--border)] w-full max-w-3xl rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[var(--primary)]" />
                  Tunnel Daemon Journal Logs
                </h2>
                <p className="text-xxs text-[var(--muted-foreground)] mt-0.5">
                  Tunnel: <span className="font-mono">{activeTunnel.name} ({activeTunnel.id})</span>
                </p>
              </div>
              <button onClick={() => setShowLogsModal(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 bg-black/95 text-green-400 font-mono text-[10px] h-[50vh] overflow-y-auto space-y-1 p-4 rounded-b-none border-b border-[var(--border)] whitespace-pre-wrap select-all">
              {loadingLogs ? (
                <div className="flex items-center justify-center h-full gap-2 text-[var(--muted-foreground)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Fetching journal output...
                </div>
              ) : (
                logsText
              )}
            </div>

            <div className="p-5 bg-[var(--secondary)]/10 border-t border-[var(--border)] flex items-center justify-between">
              <Button onClick={handleRefreshLogs} disabled={loadingLogs} className="text-xs h-9 px-3 bg-transparent text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--secondary)]/50 flex items-center gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? "animate-spin" : ""}`} />
                Refresh Logs
              </Button>
              <Button type="button" onClick={() => setShowLogsModal(false)} className="text-xs h-9 px-4 bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90">
                Close Console
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
