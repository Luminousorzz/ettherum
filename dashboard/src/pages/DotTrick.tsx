import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Search, Copy, Check, Trash2, Info, AlertCircle } from "lucide-react";

export default function DotTrick() {
  const [emailInput, setEmailInput] = useState("");
  const [generatedBase, setGeneratedBase] = useState("");
  const [variants, setVariants] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load cached latest result on mount
  useEffect(() => {
    const cachedEmail = localStorage.getItem("dottrick_base_email");
    const cachedVariants = localStorage.getItem("dottrick_variants");
    if (cachedEmail && cachedVariants) {
      try {
        const parsed = JSON.parse(cachedVariants);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setEmailInput(cachedEmail);
          setGeneratedBase(cachedEmail);
          setVariants(parsed);
        }
      } catch (e) {
        // Ignore JSON parse error
      }
    }
  }, []);

  // Normalizes the email local part (removes dots before generating)
  const normalizeEmail = (email: string) => {
    const parts = email.trim().split("@");
    if (parts.length !== 2) return null;
    const localPart = parts[0].replace(/\./g, "");
    const domain = parts[1].toLowerCase();
    return { localPart, domain };
  };

  const handleGenerate = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSearchQuery("");

    if (!emailInput.trim()) {
      setError("Please enter an email address");
      return;
    }

    const normalized = normalizeEmail(emailInput);
    if (!normalized) {
      setError("Invalid email format (must contain exactly one @ symbol)");
      return;
    }

    const { localPart, domain } = normalized;

    if (localPart.length === 0) {
      setError("Email username cannot be empty");
      return;
    }

    // Limit username length to prevent browser freeze (2^13 = 8192 variants is very safe)
    if (localPart.length > 13) {
      setError(`Username is too long (${localPart.length} chars). To prevent browser lag, username is capped at 13 characters.`);
      return;
    }

    const generated: string[] = [];
    const n = localPart.length;
    const numVariants = 1 << (n - 1); // 2^(n-1) combinations

    for (let i = 0; i < numVariants; i++) {
      let variant = "";
      for (let j = 0; j < n; j++) {
        variant += localPart[j];
        if (((i >> j) & 1) === 1 && j < n - 1) {
          variant += ".";
        }
      }
      generated.push(`${variant}@${domain}`);
    }

    // Sort generated aliases to look neat
    generated.sort();

    setVariants(generated);
    setGeneratedBase(emailInput.trim());

    // Cache results locally
    localStorage.setItem("dottrick_base_email", emailInput.trim());
    localStorage.setItem("dottrick_variants", JSON.stringify(generated));
  };

  const handleClear = () => {
    setEmailInput("");
    setGeneratedBase("");
    setVariants([]);
    setSearchQuery("");
    setError(null);
    localStorage.removeItem("dottrick_base_email");
    localStorage.removeItem("dottrick_variants");
  };

  // Filter variants based on search query
  const filteredVariants = useMemo(() => {
    if (!searchQuery.trim()) return variants;
    const q = searchQuery.toLowerCase().trim();
    return variants.filter((v) => v.toLowerCase().includes(q));
  }, [variants, searchQuery]);

  const handleCopyOne = (email: string) => {
    navigator.clipboard.writeText(email);
    setCopiedEmail(email);
    setTimeout(() => {
      setCopiedEmail((prev) => (prev === email ? null : prev));
    }, 2000);
  };

  const handleCopyAll = () => {
    if (filteredVariants.length === 0) return;
    navigator.clipboard.writeText(filteredVariants.join("\n"));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Title Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Dottrick</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Operational tools and assisted workflows.
        </p>
      </div>

      {/* Input Section Card */}
      <Card className="border-[var(--border)] bg-[var(--card)]">
        <CardContent className="pt-6 space-y-4">
          <form onSubmit={handleGenerate} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                Base Email
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">
                  <Mail className="w-4 h-4" />
                </span>
                <Input
                  type="text"
                  placeholder="reddark553@gmail.com"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    if (error) setError(null);
                  }}
                  className="pl-10 font-mono text-sm border-[var(--border)] focus-visible:ring-[var(--ring)]"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="submit"
                className="bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90 font-medium px-6"
              >
                Generate
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleClear}
                className="border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--secondary)]"
              >
                Clear
              </Button>
            </div>
          </form>

          {/* Normalization explanation */}
          <p className="text-xs text-[var(--muted-foreground)]">
            We normalize the local part by removing existing dots first, then generate every dot placement variant.
          </p>

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-[var(--error)]/10 p-3 text-sm text-[var(--error)]">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Cards Section */}
      {variants.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-[var(--border)] bg-[var(--card)]">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                Generated
              </CardDescription>
              <CardTitle className="text-3xl font-mono text-[var(--primary)]">
                {variants.length}
              </CardTitle>
            </CardHeader>
          </Card>

          <Card className="border-[var(--border)] bg-[var(--card)]">
            <CardHeader className="pb-2">
              <CardDescription className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                Cached Locally
              </CardDescription>
              <CardTitle className="text-lg font-medium text-[var(--foreground)] mt-2">
                Latest result only
              </CardTitle>
            </CardHeader>
          </Card>
        </div>
      )}

      {/* Search and Results Section */}
      {variants.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {/* Search Input */}
            <div className="relative w-full md:max-w-md">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]">
                <Search className="w-4 h-4" />
              </span>
              <Input
                type="text"
                placeholder="Search generated alias"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 font-mono text-sm border-[var(--border)] focus-visible:ring-[var(--ring)]"
              />
            </div>

            {/* Generated From Info */}
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-[var(--muted-foreground)]">
                Generated from <span className="font-mono text-[var(--foreground)]">{generatedBase}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyAll}
                className="border-[var(--primary)]/30 text-[var(--primary)] hover:bg-[var(--primary)]/10"
              >
                {copiedAll ? (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1" /> Copied All!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 mr-1" /> Copy All
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Grid of Results */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredVariants.map((variant, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 hover:bg-[var(--card)] transition-colors font-mono text-xs text-[var(--foreground)]"
              >
                <span className="truncate mr-2 select-all">{variant}</span>
                <button
                  onClick={() => handleCopyOne(variant)}
                  className="p-1 rounded text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--secondary)] transition-colors flex-shrink-0"
                  title="Copy email"
                >
                  {copiedEmail === variant ? (
                    <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>

          {/* No search results fallback */}
          {filteredVariants.length === 0 && (
            <div className="flex flex-col items-center justify-center p-8 rounded-lg border border-dashed border-[var(--border)] text-center">
              <Info className="w-8 h-8 text-[var(--muted-foreground)] mb-2" />
              <p className="text-sm text-[var(--muted-foreground)]">No matching aliases found</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
