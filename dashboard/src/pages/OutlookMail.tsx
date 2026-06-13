import { useState, useEffect, useRef } from "react";
import {
  Mail,
  MailOpen,
  Inbox,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  Clock,
  Eye,
  Check,
  Copy,
  ChevronRight,
  Shield,
  Loader2,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { fetchApi, API_BASE } from "../lib/api";

interface Account {
  id: number;
  email: string;
  provider: string;
  status: string;
  tokens: string | null;
  lastLoginAt?: string | null;
}

interface MailMessage {
  id: string;
  subject: string;
  sender: string;
  senderName: string;
  bodyPreview: string;
  isRead: boolean;
  createdAt: string;
}

interface MailDetail {
  id: string;
  subject: string;
  sender: string;
  senderName: string;
  bodyText?: string;
  bodyHtml?: string;
  isRead: boolean;
  createdAt: string;
}

export default function OutlookMail() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<MailDetail | null>(null);
  const [messageReaderTab, setMessageReaderTab] = useState<"html" | "text">("html");

  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState({
    accounts: false,
    messages: false,
    detail: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  // Polling ref
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initial load
  useEffect(() => {
    loadAccounts();
    return () => stopPolling();
  }, []);

  // Poll messages when account changes
  useEffect(() => {
    setSelectedMessage(null);
    if (selectedAccount && isAccountLinked(selectedAccount)) {
      loadMessages(selectedAccount.id);
      startPolling(selectedAccount.id);
    } else {
      setMessages([]);
      stopPolling();
    }
  }, [selectedAccount]);

  const loadAccounts = async () => {
    setLoading((prev) => ({ ...prev, accounts: true }));
    try {
      const res = await fetchApi<{ data: Account[] }>("/api/accounts");
      const outlookList = (res.data || []).filter((a) => a.provider === "outlook");
      setAccounts(outlookList);
      if (outlookList.length > 0 && !selectedAccount) {
        setSelectedAccount(outlookList[0]);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load Outlook accounts");
    } finally {
      setLoading((prev) => ({ ...prev, accounts: false }));
    }
  };

  const loadMessages = async (accountId: number, silent = false) => {
    if (!silent) setLoading((prev) => ({ ...prev, messages: true }));
    try {
      const data = await fetchApi<MailMessage[]>(`/api/accounts/outlook/${accountId}/messages`);
      setMessages(data);
      setError(null);
    } catch (err: any) {
      if (!silent) setError(err.message || "Failed to load emails from Microsoft Graph API");
    } finally {
      if (!silent) setLoading((prev) => ({ ...prev, messages: false }));
    }
  };

  const loadMessageDetail = async (accountId: number, msgId: string) => {
    setLoading((prev) => ({ ...prev, detail: true }));
    try {
      const data = await fetchApi<MailDetail>(`/api/accounts/outlook/${accountId}/messages/${msgId}`);
      setSelectedMessage(data);
      setMessageReaderTab(data.bodyHtml ? "html" : "text");
    } catch (err: any) {
      setError(err.message || "Failed to load email details");
    } finally {
      setLoading((prev) => ({ ...prev, detail: false }));
    }
  };

  // Polling
  const startPolling = (accountId: number) => {
    stopPolling();
    pollingRef.current = setInterval(() => {
      loadMessages(accountId, true);
    }, 8000); // Poll every 8 seconds
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const isAccountLinked = (acc: Account) => {
    return acc.status === "active";
  };

  // Link account handler
  const handleLinkAccount = (acc: Account) => {
    const width = 600;
    const height = 700;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      `${API_BASE}/api/accounts/outlook/authorize?id=${acc.id}`,
      "link_outlook_popup",
      `width=${width},height=${height},left=${left},top=${top},status=no,resizable=yes`
    );

    if (popup) {
      // Check if popup closed
      const checkTimer = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkTimer);
          // Reload accounts and check status
          loadAccounts().then(() => {
            // Re-select to trigger refresh
            setAccounts((curr) => {
              const updated = curr.find((a) => a.id === acc.id);
              if (updated && isAccountLinked(updated)) {
                setSelectedAccount(updated);
              }
              return curr;
            });
          });
        }
      }, 1000);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Filter accounts
  const filteredAccounts = accounts.filter((a) =>
    a.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)] flex items-center gap-2">
            <Mail className="w-6 h-6 text-[var(--primary)]" />
            Outlook Mailbox
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Access, view, and read emails from your registered Outlook accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadAccounts();
              if (selectedAccount) loadMessages(selectedAccount.id);
            }}
            disabled={loading.accounts || loading.messages}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${(loading.accounts || loading.messages) ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Global Error */}
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-[var(--error)] flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Error occurred</p>
            <p className="mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {accounts.length === 0 && !loading.accounts ? (
        <Card className="border-[var(--border)] p-12 text-center">
          <Inbox className="w-12 h-12 text-[var(--muted-foreground)] mx-auto mb-4 opacity-40" />
          <h3 className="text-lg font-semibold">No Outlook Accounts Found</h3>
          <p className="text-sm text-[var(--muted-foreground)] max-w-md mx-auto mt-2">
            Please add an Outlook account in the <a href="/accounts" className="text-[var(--primary)] hover:underline">Accounts</a> panel first to start reading mail.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6 items-start">
          {/* Sidebar - Accounts List */}
          <Card className="border-[var(--border)] overflow-hidden h-[calc(100vh-220px)] flex flex-col">
            <div className="p-3 border-b border-[var(--border)] bg-[var(--secondary)]/10 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
                <Input
                  placeholder="Search email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
              {loading.accounts ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="h-5 w-5 animate-spin text-[var(--muted-foreground)]" />
                </div>
              ) : (
                filteredAccounts.map((acc) => {
                  const isSelected = selectedAccount?.id === acc.id;
                  const linked = isAccountLinked(acc);

                  return (
                    <div
                      key={acc.id}
                      onClick={() => setSelectedAccount(acc)}
                      className={`p-3 transition-colors cursor-pointer text-xs flex flex-col gap-1.5 ${
                        isSelected ? "bg-[var(--primary)]/10 text-[var(--primary)]" : "hover:bg-[var(--secondary)]/30 text-[var(--foreground)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold truncate flex-1">{acc.email}</span>
                        <Badge
                          variant={linked ? "success" : "secondary"}
                          className="text-[9px] px-1 py-0 scale-90"
                        >
                          {linked ? "Linked" : "Unlinked"}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
                        <span>ID: #{acc.id}</span>
                        {linked && <span className="flex items-center gap-1"><Check className="w-3 h-3 text-emerald-500" /> Active</span>}
                      </div>
                    </div>
                  );
                })
              )}
              {filteredAccounts.length === 0 && !loading.accounts && (
                <div className="p-4 text-center text-xs text-[var(--muted-foreground)]">No matching emails</div>
              )}
            </div>
          </Card>

          {/* Main Mailbox Panel */}
          <div className="space-y-6">
            {selectedAccount ? (
              <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6 items-start">
                
                {/* Emails List */}
                <Card className="border-[var(--border)] overflow-hidden h-[calc(100vh-220px)] flex flex-col">
                  <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--secondary)]/10 flex items-center justify-between shrink-0">
                    <span className="text-xs font-bold text-[var(--foreground)] flex items-center gap-1.5">
                      <Inbox className="w-4 h-4 text-[var(--primary)]" />
                      Inbox messages
                    </span>
                    <span className="text-[10px] text-[var(--muted-foreground)]">{messages.length} messages</span>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
                    {!isAccountLinked(selectedAccount) ? (
                      <div className="p-8 text-center space-y-4">
                        <Shield className="w-12 h-12 text-amber-500/80 mx-auto opacity-80" />
                        <div className="space-y-1">
                          <h4 className="text-sm font-semibold">Account Unlinked</h4>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            This Outlook account is not connected to Microsoft API yet.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleLinkAccount(selectedAccount)}
                          className="w-full flex items-center justify-center gap-1.5"
                        >
                          <ExternalLink className="w-4 h-4" />
                          Link Microsoft Account
                        </Button>
                      </div>
                    ) : loading.messages ? (
                      <div className="flex items-center justify-center p-12">
                        <Loader2 className="h-6 w-6 animate-spin text-[var(--primary)]" />
                      </div>
                    ) : messages.length === 0 ? (
                      <div className="p-8 text-center text-xs text-[var(--muted-foreground)]">
                        No emails in inbox. Auto-refresh is listening...
                      </div>
                    ) : (
                      messages.map((msg) => {
                        const isSelected = selectedMessage?.id === msg.id;
                        return (
                          <div
                            key={msg.id}
                            onClick={() => loadMessageDetail(selectedAccount.id, msg.id)}
                            className={`p-3.5 transition-colors cursor-pointer text-xs flex flex-col gap-1.5 border-l-2 ${
                              isSelected
                                ? "bg-[var(--primary)]/5 border-[var(--primary)]"
                                : msg.isRead
                                ? "border-transparent hover:bg-[var(--secondary)]/20"
                                : "border-amber-500 bg-amber-500/5 hover:bg-amber-500/10 font-medium"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-[var(--foreground)] truncate max-w-[150px]">{msg.senderName || msg.sender}</span>
                              <span className="text-[10px] text-[var(--muted-foreground)] whitespace-nowrap flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <div className="text-xs text-[var(--foreground)] line-clamp-1">{msg.subject}</div>
                            <div className="text-[11px] text-[var(--muted-foreground)] line-clamp-2 leading-relaxed">{msg.bodyPreview}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>

                {/* Email Viewer Pane */}
                <Card className="border-[var(--border)] overflow-hidden h-[calc(100vh-220px)] flex flex-col bg-zinc-950/20">
                  {selectedMessage ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                      {/* Header details */}
                      <div className="p-4 border-b border-[var(--border)] bg-[var(--secondary)]/10 shrink-0 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <h2 className="text-sm font-bold text-[var(--foreground)] leading-snug">{selectedMessage.subject}</h2>
                          <div className="flex items-center gap-1 shrink-0">
                            {copiedText === selectedMessage.id ? (
                              <Badge variant="success" className="text-[10px]"><Check className="w-3.5 h-3.5 mr-0.5" /> Copied</Badge>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-[var(--muted-foreground)] hover:text-[var(--foreground)]" onClick={() => handleCopy(selectedMessage.subject)} title="Copy Subject">
                                <Copy className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:justify-between text-xs text-[var(--muted-foreground)]">
                          <div>
                            <span className="font-semibold text-[var(--foreground)]">{selectedMessage.senderName || selectedMessage.sender}</span>
                            <span className="mx-1.5">&lt;{selectedMessage.sender}&gt;</span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Clock className="w-3.5 h-3.5" />
                            {new Date(selectedMessage.createdAt).toLocaleString()}
                          </div>
                        </div>

                        {/* Text / HTML tabs */}
                        {selectedMessage.bodyHtml && (
                          <div className="flex gap-1.5 shrink-0 pt-1">
                            <button
                              onClick={() => setMessageReaderTab("html")}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                                messageReaderTab === "html"
                                  ? "bg-[var(--primary)] text-white"
                                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              HTML
                            </button>
                            <button
                              onClick={() => setMessageReaderTab("text")}
                              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                                messageReaderTab === "text"
                                  ? "bg-[var(--primary)] text-white"
                                  : "bg-[var(--secondary)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                              }`}
                            >
                              Text
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Content Reader */}
                      <div className="flex-1 overflow-auto p-4 bg-[var(--background)]">
                        {loading.detail ? (
                          <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-8 w-8 animate-spin text-[var(--primary)]" />
                          </div>
                        ) : messageReaderTab === "html" && selectedMessage.bodyHtml ? (
                          <iframe
                            srcDoc={`
                              <html>
                                <head>
                                  <style>
                                    body {
                                      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                                      color: #e5e7eb;
                                      background-color: transparent;
                                      margin: 0;
                                      padding: 8px;
                                      line-height: 1.6;
                                      word-break: break-word;
                                    }
                                    a { color: #3b82f6; text-decoration: none; }
                                    a:hover { text-decoration: underline; }
                                  </style>
                                </head>
                                <body>
                                  ${selectedMessage.bodyHtml}
                                </body>
                              </html>
                            `}
                            title="Email message body"
                            className="w-full h-full border-0 bg-transparent"
                            sandbox="allow-popups allow-popups-to-escape-sandbox"
                          />
                        ) : (
                          <pre className="text-xs text-[var(--foreground)] whitespace-pre-wrap font-mono leading-relaxed bg-[var(--secondary)]/10 p-3 rounded-lg border border-[var(--border)]">
                            {selectedMessage.bodyText || selectedMessage.bodyHtml?.replace(/<[^>]*>/g, "") || "(No Content)"}
                          </pre>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-[var(--muted-foreground)]">
                      <Mail className="w-12 h-12 mb-3 opacity-30 text-[var(--primary)]" />
                      <h4 className="text-sm font-semibold">Select an email to read</h4>
                      <p className="text-xs opacity-75 mt-1 max-w-xs">
                        Choose any message from the inbox list on the left to read its full contents.
                      </p>
                    </div>
                  )}
                </Card>

              </div>
            ) : (
              <Card className="border-[var(--border)] p-12 text-center text-[var(--muted-foreground)] h-[calc(100vh-220px)] flex flex-col items-center justify-center">
                <Inbox className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm font-medium">Select an Outlook Account</p>
                <p className="text-xs opacity-70 mt-1">Select one of your accounts from the sidebar list to inspect its inbox.</p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
