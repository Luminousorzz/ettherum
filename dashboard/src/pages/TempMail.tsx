import { useState, useEffect, useRef } from "react";
import {
  Mail,
  MailOpen,
  Inbox,
  Settings,
  Plus,
  Trash2,
  Copy,
  Check,
  Search,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  Lock,
  Server,
  ArrowLeft,
  Clock,
  Eye,
  X,
} from "lucide-react";
import {
  fetchTempMailDomains,
  createTempMailDomain,
  deleteTempMailDomain,
  fetchTempMailAddresses,
  createTempMailAddress,
  deleteTempMailAddress,
  fetchTempMailMessages,
  deleteTempMailMessage,
  clearTempMailMessages,
  fetchTempMailSettings,
  saveTempMailSettings,
  TempMailDomain,
  TempMailAddress,
  TempMailMessage,
  TempMailSettings,
  API_BASE,
} from "../lib/api";

export default function TempMail() {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<"inbox" | "settings">("inbox");

  // State lists
  const [domains, setDomains] = useState<TempMailDomain[]>([]);
  const [addresses, setAddresses] = useState<TempMailAddress[]>([]);
  const [messages, setMessages] = useState<TempMailMessage[]>([]);

  // Selection states
  const [selectedDomainId, setSelectedDomainId] = useState<number | "">("");
  const [selectedAddress, setSelectedAddress] = useState<TempMailAddress | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<TempMailMessage | null>(null);
  const [messageReaderTab, setMessageReaderTab] = useState<"html" | "text" | "raw">("html");

  // Input states
  const [newDomain, setNewDomain] = useState("");
  const [customPrefix, setCustomPrefix] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Settings states
  const [settings, setSettings] = useState<TempMailSettings>({
    smtpEnabled: false,
    smtpPort: 2525,
    webhookSecret: "",
  });
  const [showSecret, setShowSecret] = useState(false);

  // UI status states
  const [loading, setLoading] = useState({
    domains: false,
    addresses: false,
    messages: false,
    settings: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal toggles
  const [showAddDomainModal, setShowAddDomainModal] = useState(false);

  // Timers & Polling refs
  const pollingRef = useRef<any>(null);

  // Initial load
  useEffect(() => {
    loadDomains();
    loadAddresses();
    loadSettings();
    return () => {
      stopPolling();
    };
  }, []);

  // Poll messages when address changes
  useEffect(() => {
    setSelectedMessage(null);
    if (selectedAddress) {
      loadMessages(selectedAddress.id);
      startPolling(selectedAddress.id);
    } else {
      setMessages([]);
      stopPolling();
    }
  }, [selectedAddress]);

  // Copy helper
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // DATA ACTIONS
  // ─────────────────────────────────────────────────────────────────────────────

  const loadDomains = async () => {
    setLoading(prev => ({ ...prev, domains: true }));
    try {
      const data = await fetchTempMailDomains();
      setDomains(data);
      if (data.length > 0 && !selectedDomainId) {
        setSelectedDomainId(data[0].id);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load domains");
    } finally {
      setLoading(prev => ({ ...prev, domains: false }));
    }
  };

  const loadAddresses = async () => {
    setLoading(prev => ({ ...prev, addresses: true }));
    try {
      const data = await fetchTempMailAddresses();
      setAddresses(data);
    } catch (err: any) {
      setError(err.message || "Failed to load addresses");
    } finally {
      setLoading(prev => ({ ...prev, addresses: false }));
    }
  };

  const loadMessages = async (addressId: number, silent = false) => {
    if (!silent) setLoading(prev => ({ ...prev, messages: true }));
    try {
      const data = await fetchTempMailMessages(addressId);
      setMessages(data);
    } catch (err: any) {
      if (!silent) setError(err.message || "Failed to load messages");
    } finally {
      if (!silent) setLoading(prev => ({ ...prev, messages: false }));
    }
  };

  const loadSettings = async () => {
    setLoading(prev => ({ ...prev, settings: true }));
    try {
      const data = await fetchTempMailSettings();
      setSettings(data);
    } catch (err: any) {
      setError(err.message || "Failed to load settings");
    } finally {
      setLoading(prev => ({ ...prev, settings: false }));
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomain.trim()) return;
    setError(null);
    try {
      const created = await createTempMailDomain(newDomain);
      setDomains(prev => [created, ...prev]);
      setSelectedDomainId(created.id);
      setNewDomain("");
      setShowAddDomainModal(false);
      setSuccessMsg("Domain added successfully!");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to add domain");
    }
  };

  const handleDeleteDomain = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete the domain "${name}"? This will delete all associated email addresses and messages.`)) {
      return;
    }
    try {
      await deleteTempMailDomain(id);
      setDomains(prev => prev.filter(d => d.id !== id));
      if (selectedDomainId === id) {
        setSelectedDomainId("");
      }
      loadAddresses();
      setSelectedAddress(null);
    } catch (err: any) {
      setError(err.message || "Failed to delete domain");
    }
  };

  const handleGenerateAddress = async () => {
    if (!selectedDomainId) {
      setError("Please select or add a domain first.");
      return;
    }
    setError(null);
    try {
      const created = await createTempMailAddress(
        Number(selectedDomainId),
        customPrefix.trim() || undefined
      );
      setAddresses(prev => [created, ...prev]);
      setSelectedAddress(created);
      setCustomPrefix("");
    } catch (err: any) {
      setError(err.message || "Failed to generate address");
    }
  };

  const handleDeleteAddress = async (id: number, addr: string) => {
    if (!confirm(`Delete temporary address "${addr}"? All inbox messages will be permanently deleted.`)) {
      return;
    }
    try {
      await deleteTempMailAddress(id);
      setAddresses(prev => prev.filter(a => a.id !== id));
      if (selectedAddress?.id === id) {
        setSelectedAddress(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete address");
    }
  };

  const handleClearInbox = async (addressId: number) => {
    if (!confirm("Are you sure you want to delete all messages in this inbox?")) return;
    try {
      await clearTempMailMessages(addressId);
      setMessages([]);
      setSelectedMessage(null);
    } catch (err: any) {
      setError(err.message || "Failed to clear inbox");
    }
  };

  const handleDeleteMessage = async (id: number) => {
    try {
      await deleteTempMailMessage(id);
      setMessages(prev => prev.filter(m => m.id !== id));
      if (selectedMessage?.id === id) {
        setSelectedMessage(null);
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete message");
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await saveTempMailSettings(settings);
      setSettings(res.settings);
      setSuccessMsg("Settings updated successfully! SMTP server updated.");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to save settings");
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // POLLING UTILS
  // ─────────────────────────────────────────────────────────────────────────────
  const startPolling = (addressId: number) => {
    stopPolling();
    pollingRef.current = setInterval(() => {
      loadMessages(addressId, true);
    }, 5000);
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER HELPERS
  // ─────────────────────────────────────────────────────────────────────────────
  const filteredAddresses = addresses.filter(a =>
    a.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getWebhookUrl = () => {
    // Determine api base. If local dev, use port 1930, otherwise use origin
    const origin = window.location.origin;
    if (API_BASE.startsWith("http")) {
      return `${API_BASE}/api/temp-mail/incoming?secret=${settings.webhookSecret}`;
    }
    return `${origin}/api/temp-mail/incoming?secret=${settings.webhookSecret}`;
  };

  const getCloudflareWorkerCode = () => {
    return `export default {
  async email(message, env, ctx) {
    const rawEmail = await new Response(message.raw).text();
    const webhookUrl = "${getWebhookUrl()}";

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: rawEmail
      });

      if (!response.ok) {
        console.error("Failed to forward email:", response.statusText);
      }
    } catch (err) {
      console.error("Error forwarding email webhook:", err);
    }
  }
};`;
  };

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] p-4 bg-[var(--card)]">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--foreground)] flex items-center gap-2">
            <MailOpen className="w-5 h-5 text-[var(--primary)]" />
            Temp Mail
          </h1>
          <p className="text-xs text-[var(--muted-foreground)]">
            Create temporary disposable email addresses using your own custom domains.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("inbox")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 border ${
              activeTab === "inbox"
                ? "bg-[var(--primary)]/10 border-[var(--primary)] text-[var(--primary)]"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)]"
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            Inbox
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 border ${
              activeTab === "settings"
                ? "bg-[var(--primary)]/10 border-[var(--primary)] text-[var(--primary)]"
                : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)]"
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            Configure Setup
          </button>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 overflow-hidden relative">
        {/* Alerts */}
        {error && (
          <div className="absolute top-2 left-4 right-4 z-40 bg-[var(--error)]/10 border border-[var(--error)]/50 text-[var(--error)] p-3 rounded-md flex items-center justify-between text-xs animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-[var(--error)] hover:opacity-80">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {successMsg && (
          <div className="absolute top-2 left-4 right-4 z-40 bg-[var(--success)]/10 border border-[var(--success)]/50 text-[var(--success)] p-3 rounded-md flex items-center justify-between text-xs animate-in fade-in">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-[var(--success)] hover:opacity-80">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {activeTab === "inbox" ? (
          <div className="flex h-full divide-x divide-[var(--border)]">
            
            {/* LEFT COLUMN: Sidebar Address Manager */}
            <div className="w-[320px] flex flex-col h-full bg-[var(--sidebar-bg)] overflow-y-auto">
              
              {/* Domain & Generator Section */}
              <div className="p-4 border-b border-[var(--border)] space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                    Target Domain
                  </label>
                  <button
                    onClick={() => setShowAddDomainModal(true)}
                    className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1 font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Domains
                  </button>
                </div>
                
                {/* Domain selector */}
                <div className="flex gap-2">
                  <select
                    value={selectedDomainId}
                    onChange={(e) => setSelectedDomainId(e.target.value ? Number(e.target.value) : "")}
                    className="flex-1 bg-[var(--secondary)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                  >
                    <option value="" disabled>Select domain...</option>
                    {domains.map(d => (
                      <option key={d.id} value={d.id}>{d.domain}</option>
                    ))}
                  </select>
                </div>

                {/* Address Generator Form */}
                <div className="space-y-2 pt-1">
                  <label className="text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                    Custom Prefix (Optional)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="e.g. support, random"
                      value={customPrefix}
                      onChange={(e) => setCustomPrefix(e.target.value)}
                      className="flex-1 bg-[var(--secondary)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] placeholder-[var(--muted-foreground)]"
                    />
                    <button
                      onClick={handleGenerateAddress}
                      disabled={loading.addresses || !selectedDomainId}
                      className="bg-[var(--primary)] hover:opacity-90 disabled:opacity-50 text-[var(--primary-foreground)] rounded-md p-1.5 flex items-center justify-center font-bold aspect-square transition-all"
                      title="Generate new email address"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Usage counter */}
                <div className="text-[10px] text-[var(--muted-foreground)] flex items-center justify-between pt-1">
                  <span>Addresses quota limit:</span>
                  <span className="font-semibold text-[var(--foreground)]">
                    {addresses.length} / 100 configured
                  </span>
                </div>
              </div>

              {/* Address Search */}
              <div className="p-3 border-b border-[var(--border)] bg-[var(--background)]">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[var(--muted-foreground)] absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search address..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-[var(--secondary)] border border-[var(--border)] rounded-md pl-8 pr-3 py-1.5 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] placeholder-[var(--muted-foreground)]"
                  />
                </div>
              </div>

              {/* Generated Addresses List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredAddresses.length === 0 ? (
                  <div className="text-center py-8 text-xs text-[var(--muted-foreground)]">
                    {addresses.length === 0 ? "No email addresses generated yet." : "No matching address found."}
                  </div>
                ) : (
                  filteredAddresses.map(addr => {
                    const isSelected = selectedAddress?.id === addr.id;
                    return (
                      <div
                        key={addr.id}
                        onClick={() => setSelectedAddress(addr)}
                        className={`group p-2.5 rounded-md flex items-center justify-between cursor-pointer transition-all border ${
                          isSelected
                            ? "bg-[var(--primary)]/10 border-[var(--primary)]/50 text-[var(--primary)]"
                            : "bg-transparent border-transparent hover:bg-[var(--secondary)] text-[var(--foreground)]"
                        }`}
                      >
                        <div className="flex items-center gap-2 overflow-hidden mr-2">
                          <Mail className={`w-4 h-4 flex-shrink-0 ${isSelected ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`} />
                          <span className="text-xs truncate font-medium">{addr.address}</span>
                        </div>
                        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(addr.address);
                            }}
                            className="p-1 rounded hover:bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                            title="Copy Address"
                          >
                            {copiedText === addr.address ? (
                              <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAddress(addr.id, addr.address);
                            }}
                            className="p-1 rounded hover:bg-[var(--error)]/20 text-[var(--muted-foreground)] hover:text-[var(--error)]"
                            title="Delete Address"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Inbox & Message Reader */}
            <div className="flex-1 flex flex-col h-full bg-[var(--background)] overflow-hidden">
              {!selectedAddress ? (
                // No address selected empty state
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 rounded-full bg-[var(--secondary)] border border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)] mb-4 animate-pulse">
                    <Inbox className="w-8 h-8 text-[var(--muted-foreground)]/60" />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">Select an email to view inbox</h3>
                  <p className="text-xs text-[var(--muted-foreground)] mt-1 max-w-sm">
                    Choose one of your active disposable email addresses from the sidebar list, or generate a new one.
                  </p>
                </div>
              ) : (
                <div className="flex-1 flex overflow-hidden">
                  
                  {/* Messages Inbox List */}
                  <div className="w-[300px] flex flex-col h-full border-r border-[var(--border)] bg-[var(--card)]">
                    <div className="p-3 border-b border-[var(--border)] flex items-center justify-between bg-[var(--sidebar-bg)]">
                      <span className="text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                        Inbox messages
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => loadMessages(selectedAddress.id)}
                          className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)] rounded"
                          title="Refresh"
                          disabled={loading.messages}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${loading.messages ? "animate-spin text-[var(--primary)]" : ""}`} />
                        </button>
                        <button
                          onClick={() => handleClearInbox(selectedAddress.id)}
                          disabled={messages.length === 0}
                          className="p-1 text-[var(--muted-foreground)] hover:text-[var(--error)] disabled:opacity-45 rounded"
                          title="Clear inbox"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                      {loading.messages && messages.length === 0 ? (
                        <div className="flex items-center justify-center py-12 gap-2 text-xs text-[var(--muted-foreground)]">
                          <RefreshCw className="w-4 h-4 animate-spin text-[var(--primary)]" />
                          <span>Loading messages...</span>
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="text-center py-12 px-4 space-y-2">
                          <div className="flex justify-center">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--primary)] opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--primary)]"></span>
                            </span>
                          </div>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            Waiting for incoming emails...
                          </p>
                          <p className="text-[10px] text-[var(--muted-foreground)] opacity-70">
                            Updates automatically every 5s
                          </p>
                        </div>
                      ) : (
                        messages.map(msg => {
                          const isSelected = selectedMessage?.id === msg.id;
                          return (
                            <div
                              key={msg.id}
                              onClick={() => setSelectedMessage(msg)}
                              className={`p-3 rounded-md cursor-pointer border transition-all ${
                                isSelected
                                  ? "bg-[var(--primary)]/10 border-[var(--primary)] text-[var(--foreground)]"
                                  : `bg-[var(--background)] border-[var(--border)] hover:bg-[var(--secondary)] ${
                                      !msg.isRead ? "border-l-4 border-l-[var(--primary)] font-semibold text-[var(--foreground)]" : "text-[var(--muted-foreground)]"
                                    }`
                              }`}
                            >
                              <div className="flex items-center justify-between text-[10px] mb-1">
                                <span className="truncate max-w-[140px] font-semibold text-[var(--foreground)]">
                                  {msg.sender.split("<")[0].trim() || msg.sender}
                                </span>
                                <span className="text-[var(--muted-foreground)] opacity-80 flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <h4 className="text-xs font-semibold text-[var(--foreground)] truncate">
                                {msg.subject}
                              </h4>
                              <p className="text-[10px] text-[var(--muted-foreground)] line-clamp-2 mt-1">
                                {msg.bodyText || "(No plain text content)"}
                              </p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Mail Reader Panel */}
                  <div className="flex-1 flex flex-col h-full bg-[var(--background)] overflow-hidden">
                    {!selectedMessage ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-[var(--card)]/30">
                        <Mail className="w-12 h-12 text-[var(--muted-foreground)]/40 mb-3" />
                        <h4 className="text-xs font-semibold text-[var(--foreground)]">No message selected</h4>
                        <p className="text-[11px] text-[var(--muted-foreground)] mt-1">
                          Click on any email in the inbox list to read its contents here.
                        </p>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col h-full overflow-hidden">
                        {/* Header Details */}
                        <div className="p-4 border-b border-[var(--border)] bg-[var(--card)] space-y-2">
                          <div className="flex items-start justify-between">
                            <h2 className="text-sm font-bold text-[var(--foreground)]">
                              {selectedMessage.subject}
                            </h2>
                            <button
                              onClick={() => handleDeleteMessage(selectedMessage.id)}
                              className="p-1.5 hover:bg-[var(--error)]/10 text-[var(--muted-foreground)] hover:text-[var(--error)] rounded transition-colors"
                              title="Delete Message"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          
                          <div className="text-[11px] space-y-1 text-[var(--muted-foreground)]">
                            <div>
                              <span className="font-semibold text-[var(--foreground)]">From:</span>{" "}
                              {selectedMessage.sender}
                            </div>
                            <div className="flex justify-between">
                              <span>
                                <span className="font-semibold text-[var(--foreground)]">Date:</span>{" "}
                                {new Date(selectedMessage.createdAt).toLocaleString()}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Format Tab selectors */}
                        <div className="flex border-b border-[var(--border)] bg-[var(--secondary)]/40 text-xs px-2 justify-between items-center">
                          <div className="flex gap-1 py-1">
                            <button
                              onClick={() => setMessageReaderTab("html")}
                              className={`px-3 py-1 rounded-md text-[10px] font-bold ${
                                messageReaderTab === "html"
                                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              HTML View
                            </button>
                            <button
                              onClick={() => setMessageReaderTab("text")}
                              className={`px-3 py-1 rounded-md text-[10px] font-bold ${
                                messageReaderTab === "text"
                                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              Text View
                            </button>
                            <button
                              onClick={() => setMessageReaderTab("raw")}
                              className={`px-3 py-1 rounded-md text-[10px] font-bold ${
                                messageReaderTab === "raw"
                                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              Raw Source
                            </button>
                          </div>
                        </div>

                        {/* Content viewport */}
                        <div className="flex-1 p-4 overflow-y-auto bg-[var(--card)]/10">
                          {messageReaderTab === "html" ? (
                            selectedMessage.bodyHtml ? (
                              <div className="w-full h-full min-h-[400px] border border-[var(--border)] rounded-lg overflow-hidden bg-white shadow-inner">
                                <iframe
                                  srcDoc={`
                                    <!DOCTYPE html>
                                    <html>
                                      <head>
                                        <meta charset="utf-8">
                                        <style>
                                          body { font-family: sans-serif; color: #333333; line-height: 1.5; padding: 16px; margin: 0; }
                                          img { max-width: 100%; height: auto; }
                                          a { color: #0088ff; text-decoration: underline; }
                                        </style>
                                      </head>
                                      <body>
                                        ${selectedMessage.bodyHtml}
                                      </body>
                                    </html>
                                  `}
                                  title="HTML Email Body"
                                  className="w-full h-full min-h-[400px] bg-white text-black"
                                  sandbox="allow-popups"
                                />
                              </div>
                            ) : (
                              <div className="text-center py-12 text-xs text-[var(--muted-foreground)] bg-[var(--card)] border border-[var(--border)] rounded-lg">
                                No HTML body available. Switching to Text View.
                              </div>
                            )
                          ) : messageReaderTab === "text" ? (
                            <pre className="text-xs p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg overflow-x-auto whitespace-pre-wrap font-mono text-[var(--foreground)] leading-relaxed shadow-sm">
                              {selectedMessage.bodyText || "(No plain text content)"}
                            </pre>
                          ) : (
                            <pre className="text-[10px] p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg overflow-x-auto whitespace-pre font-mono text-[var(--muted-foreground)] leading-tight shadow-sm max-h-[500px]">
                              {selectedMessage.rawEmail}
                            </pre>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>

          </div>
        ) : (
          
          /* SETTINGS & INTEGRATION SETUP TAB */
          <div className="max-w-4xl mx-auto p-6 space-y-6 h-full overflow-y-auto">
            
            {/* System Setup Configuration */}
            <form onSubmit={handleSaveSettings} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-5 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
                <Server className="w-5 h-5 text-[var(--primary)]" />
                <h2 className="text-sm font-bold text-[var(--foreground)]">Built-In SMTP Server</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--foreground)]">
                    SMTP Server Status
                  </label>
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    Toggle to listen directly for incoming emails. Requires port forwarding.
                  </p>
                  <div className="pt-1">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.smtpEnabled}
                        onChange={(e) => setSettings(prev => ({ ...prev, smtpEnabled: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-[var(--secondary)] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[var(--primary)]"></div>
                      <span className="ml-2.5 text-xs text-[var(--foreground)]">
                        {settings.smtpEnabled ? "Active & Running" : "Disabled"}
                      </span>
                    </label>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--foreground)]">
                    SMTP Inbound Port
                  </label>
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    Standard SMTP is port 25. Standard forwarding/VPS bypass is port 2525.
                  </p>
                  <input
                    type="number"
                    value={settings.smtpPort}
                    onChange={(e) => setSettings(prev => ({ ...prev, smtpPort: parseInt(e.target.value) || 2525 }))}
                    className="w-full bg-[var(--secondary)] border border-[var(--border)] rounded-md px-3 py-1.5 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] font-mono"
                    disabled={!settings.smtpEnabled}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="submit"
                  disabled={loading.settings}
                  className="bg-[var(--primary)] hover:opacity-90 disabled:opacity-50 text-[var(--primary-foreground)] rounded-md px-4 py-2 text-xs font-bold transition-all shadow"
                >
                  {loading.settings ? "Saving..." : "Save SMTP Config"}
                </button>
              </div>
            </form>

            {/* Cloudflare Worker Integration Setup */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-5 space-y-4 shadow-sm">
              <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
                <ExternalLink className="w-5 h-5 text-[var(--primary)]" />
                <h2 className="text-sm font-bold text-[var(--foreground)]">Cloudflare Email Routing (Recommended)</h2>
              </div>
              
              <div className="text-xs space-y-2.5 leading-relaxed text-[var(--muted-foreground)]">
                <p>
                  Because home ISPs block Port 25, the easiest way to receive emails on your domain is to use Cloudflare Email Routing.
                  It is 100% free and routes all emails sent to your domain to a Cloudflare Worker, which instantly forwards it here.
                </p>
                <div className="space-y-1 bg-[var(--secondary)] p-3 rounded-md border border-[var(--border)]">
                  <h3 className="text-xs font-bold text-[var(--foreground)] flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-[var(--primary)]" />
                    Incoming Webhook Endpoint details
                  </h3>
                  <div className="pt-2 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="block font-semibold text-[var(--foreground)] text-[10px] uppercase">Webhook Url</span>
                      <div className="flex gap-2 mt-1">
                        <input
                          type="text"
                          readOnly
                          value={getWebhookUrl()}
                          className="flex-1 bg-[var(--background)] border border-[var(--border)] rounded-md px-2.5 py-1 text-[10px] text-[var(--muted-foreground)] focus:outline-none font-mono"
                        />
                        <button
                          onClick={() => handleCopy(getWebhookUrl())}
                          className="px-2 py-1 bg-[var(--secondary)] hover:bg-[var(--muted)] border border-[var(--border)] rounded text-[10px]"
                        >
                          {copiedText === getWebhookUrl() ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <span className="block font-semibold text-[var(--foreground)] text-[10px] uppercase">Webhook Secret</span>
                      <div className="flex gap-2 mt-1">
                        <input
                          type={showSecret ? "text" : "password"}
                          readOnly
                          value={settings.webhookSecret}
                          className="flex-1 bg-[var(--background)] border border-[var(--border)] rounded-md px-2.5 py-1 text-[10px] text-[var(--muted-foreground)] focus:outline-none font-mono"
                        />
                        <button
                          onClick={() => setShowSecret(!showSecret)}
                          className="px-2 py-1 bg-[var(--secondary)] hover:bg-[var(--muted)] border border-[var(--border)] rounded text-[10px]"
                        >
                          {showSecret ? "Hide" : "Show"}
                        </button>
                        <button
                          onClick={() => handleCopy(settings.webhookSecret)}
                          className="px-2 py-1 bg-[var(--secondary)] hover:bg-[var(--muted)] border border-[var(--border)] rounded text-[10px]"
                        >
                          {copiedText === settings.webhookSecret ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-bold text-[var(--foreground)]">Setup Steps:</h4>
                  <ol className="list-decimal list-inside space-y-1.5 text-[11px] pl-1">
                    <li>Add your domain to your free Cloudflare account.</li>
                    <li>Go to your Domain Dashboard → <strong>Email</strong> → <strong>Email Routing</strong> and click Enable.</li>
                    <li>Create a new Cloudflare Worker and copy-paste the generated routing script below.</li>
                    <li>Go to Email Routing → <strong>Destination addresses</strong> → Bind worker, and choose your Worker name.</li>
                    <li>Create a <strong>Catch-all rule</strong> routing all emails to your Worker. Done!</li>
                  </ol>
                </div>

                {/* CF Worker Code blocks */}
                <div className="space-y-1.5 pt-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[var(--foreground)]">Cloudflare Worker Script:</span>
                    <button
                      onClick={() => handleCopy(getCloudflareWorkerCode())}
                      className="px-2.5 py-1 bg-[var(--primary)] text-[var(--primary-foreground)] rounded hover:opacity-90 text-[10px] font-bold flex items-center gap-1 shadow"
                    >
                      {copiedText === getCloudflareWorkerCode() ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Copied Worker Code!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Script Code
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="bg-[var(--secondary)] p-4 border border-[var(--border)] rounded-lg text-[10px] text-[var(--foreground)] font-mono overflow-x-auto shadow-inner leading-relaxed max-h-[300px]">
                    {getCloudflareWorkerCode()}
                  </pre>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* DOMAIN MANAGER MODAL */}
      {showAddDomainModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg max-w-md w-full p-5 shadow-lg space-y-4 animate-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-2.5">
              <h3 className="text-sm font-bold text-[var(--foreground)]">Manage Custom Domains</h3>
              <button
                onClick={() => {
                  setError(null);
                  setShowAddDomainModal(false);
                }}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Add Domain Input Form */}
            <form onSubmit={handleAddDomain} className="space-y-2">
              <label className="text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider block">
                Add New Domain
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. my-domain.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  className="flex-1 bg-[var(--secondary)] border border-[var(--border)] rounded-md px-2.5 py-1.5 text-xs text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)] placeholder-[var(--muted-foreground)] font-mono"
                />
                <button
                  type="submit"
                  disabled={!newDomain.trim()}
                  className="bg-[var(--primary)] hover:opacity-90 disabled:opacity-50 text-[var(--primary-foreground)] rounded-md px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1 shadow"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            </form>

            {/* Configured Domains List */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider block">
                Configured Domains ({domains.length})
              </label>
              <div className="border border-[var(--border)] rounded-md max-h-[180px] overflow-y-auto divide-y divide-[var(--border)] bg-[var(--background)]">
                {domains.length === 0 ? (
                  <div className="text-center py-6 text-xs text-[var(--muted-foreground)]">
                    No domains configured.
                  </div>
                ) : (
                  domains.map(d => (
                    <div key={d.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-[var(--secondary)]/50">
                      <span className="font-mono font-medium text-[var(--foreground)]">{d.domain}</span>
                      <button
                        onClick={() => handleDeleteDomain(d.id, d.domain)}
                        className="text-[var(--muted-foreground)] hover:text-[var(--error)] p-1 rounded hover:bg-[var(--secondary)]"
                        title="Delete Domain"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
