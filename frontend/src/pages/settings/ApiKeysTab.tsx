import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useActionFetch } from "@/hooks/useActionFetch";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import type { ApiKey, ApiKeyCreate } from "@/types/api";

const KNOWN_SERVICES = [
  "shodan",
  "censys",
  "securitytrails",
  "binaryedge",
  "virustotal",
  "chaos",
  "whoisxmlapi",
  "hunter",
];

export function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [service, setService] = useState(KNOWN_SERVICES[0]);
  const [keyName, setKeyName] = useState("");
  const [keyValue, setKeyValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { valid: boolean | null; message: string } | null>>({});
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const { actionFetch, pending: adding } = useActionFetch();

  const fetchKeys = useCallback(async () => {
    const res = await fetch("/api/v1/settings/api-keys");
    if (res.ok) setKeys((await res.json()) as ApiKey[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  async function addKey(e: React.FormEvent) {
    e.preventDefault();
    const res = await actionFetch("/api/v1/settings/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service,
        key_name: keyName || undefined,
        key_value: keyValue,
      } satisfies ApiKeyCreate),
      errorPrefix: "Save API key",
      successMessage: "API key saved",
    });
    if (!res) return;
    const key = (await res.json()) as ApiKey;
    setKeys((prev) => {
      const filtered = prev.filter((k) => k.service !== key.service);
      return [...filtered, key].sort((a, b) => a.service.localeCompare(b.service));
    });
    setKeyValue("");
    setKeyName("");
  }

  async function deleteKey(svc: string) {
    const res = await actionFetch(`/api/v1/settings/api-keys/${svc}`, {
      method: "DELETE",
      errorPrefix: "Delete API key",
    });
    if (!res) return;
    setKeys((prev) => prev.filter((k) => k.service !== svc));
    setPendingDeleteKey(null);
  }

  async function testKey(svc: string) {
    setTesting((prev) => ({ ...prev, [svc]: true }));
    setTestResults((prev) => ({ ...prev, [svc]: null }));
    const res = await fetch(`/api/v1/settings/api-keys/${svc}/test`, { method: "POST" });
    const data = res.ok
      ? (await res.json()) as { valid: boolean | null; message: string }
      : { valid: false, message: "Request failed" };
    setTestResults((prev) => ({ ...prev, [svc]: data }));
    setTesting((prev) => ({ ...prev, [svc]: false }));
  }

  return (
    <div className="py-6 max-w-lg space-y-6">
      {/* Add form */}
      <form onSubmit={(e) => void addKey(e)} className="space-y-3">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
          Add / Update API Key
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Service
            </label>
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {KNOWN_SERVICES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Label (optional)
            </label>
            <input
              type="text"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="My key"
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Key Value
          </label>
          <div className="relative">
            <input
              type={showValue ? "text" : "password"}
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              required
              placeholder="Paste your API key here"
              className="w-full rounded-md border border-border bg-input px-3 py-2 pr-9 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="button"
              onClick={() => setShowValue((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <button
          type="submit"
          disabled={adding || !keyValue}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Save Key
        </button>
      </form>

      {/* Keys list */}
      <div>
        <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
          Configured Keys
        </h3>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : keys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No API keys configured.</p>
        ) : (
          <div className="space-y-1">
            {keys.map((k) => {
              const result = testResults[k.service];
              const isTesting = testing[k.service] ?? false;
              return (
                <div
                  key={k.id}
                  className="flex flex-col gap-1.5 rounded-md border border-border bg-card px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-sm font-semibold text-foreground">{k.service}</p>
                      {k.key_name && (
                        <p className="text-xs text-muted-foreground">{k.key_name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => void testKey(k.service)}
                        disabled={isTesting}
                        className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                      >
                        {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        Test
                      </button>
                      <button
                        onClick={() => setPendingDeleteKey(k.service)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  {result && (
                    <p className={cn(
                      "flex items-center gap-1 text-xs",
                      result.valid === true
                        ? "text-sev-low"
                        : result.valid === false
                        ? "text-sev-critical"
                        : "text-muted-foreground",
                    )}>
                      {result.valid === true ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                      ) : result.valid === false ? (
                        <AlertCircle className="h-3 w-3 shrink-0" />
                      ) : null}
                      {result.message}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={pendingDeleteKey !== null}
        onOpenChange={(o) => { if (!o) setPendingDeleteKey(null); }}
        itemName={pendingDeleteKey ?? ""}
        itemType="API key"
        onConfirm={() => { if (pendingDeleteKey) void deleteKey(pendingDeleteKey); }}
      />
    </div>
  );
}
