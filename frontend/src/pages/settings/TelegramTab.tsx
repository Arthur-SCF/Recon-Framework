import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { TelegramSettings, TelegramSettingsUpdate } from "@/types/api";

export function TelegramTab() {
  const [cfg, setCfg] = useState<TelegramSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [showToken, setShowToken] = useState(false);
  const { actionFetch, pending: saving } = useActionFetch();

  const fetchCfg = useCallback(async () => {
    const res = await fetch("/api/v1/settings/telegram");
    if (res.ok) {
      const data = (await res.json()) as TelegramSettings;
      setCfg(data);
      setChatId(data.chat_id ?? "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchCfg();
  }, [fetchCfg]);

  async function save() {
    if (!cfg) return;
    const body: TelegramSettingsUpdate = {
      enabled: cfg.enabled,
      chat_id: chatId || undefined,
      notify_new_hosts: cfg.notify_new_hosts,
      notify_host_changes: cfg.notify_host_changes,
      notify_scan_complete: cfg.notify_scan_complete,
      notify_errors: cfg.notify_errors,
      notify_host_gone: cfg.notify_host_gone,
      notify_new_subdomains: cfg.notify_new_subdomains,
      notify_takeover: cfg.notify_takeover,
      commands_enabled: cfg.commands_enabled,
    };
    if (token) body.bot_token = token;

    const res = await actionFetch("/api/v1/settings/telegram", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      errorPrefix: "Save Telegram settings",
      successMessage: "Settings saved",
    });
    if (!res) return;
    const updated = (await res.json()) as TelegramSettings;
    setCfg(updated);
    setToken("");
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/v1/settings/telegram/test", { method: "POST" });
    setTestResult(
      res.ok
        ? { ok: true, msg: "Test message sent!" }
        : { ok: false, msg: "Failed — check your token and chat ID." },
    );
    setTesting(false);
  }

  if (loading) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!cfg) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        Failed to load settings
      </div>
    );
  }

  return (
    <div className="py-6 max-w-lg space-y-6">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Enable Telegram Alerts</p>
          <p className="text-xs text-muted-foreground">
            Push notifications via Telegram bot
          </p>
        </div>
        <button
          onClick={() => setCfg({ ...cfg, enabled: !cfg.enabled })}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            cfg.enabled ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-5 w-5 rounded-full toggle-thumb transition-transform",
              cfg.enabled && "translate-x-5",
            )}
          />
        </button>
      </div>

      {/* Remote commands toggle */}
      {cfg.enabled && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Enable Remote Commands</p>
            <p className="text-xs text-muted-foreground">
              Receive button actions and text commands via Telegram (/status, /pause, /resume)
            </p>
          </div>
          <button
            onClick={() => setCfg({ ...cfg, commands_enabled: !cfg.commands_enabled })}
            className={cn(
              "relative h-6 w-11 rounded-full transition-colors",
              cfg.commands_enabled ? "bg-primary" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 h-5 w-5 rounded-full toggle-thumb transition-transform",
                cfg.commands_enabled && "translate-x-5",
              )}
            />
          </button>
        </div>
      )}

      {/* Bot token */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground">
          Bot Token
          {cfg.has_token && (
            <span className="ml-1 text-[10px] text-green-400">(configured)</span>
          )}
        </label>
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              cfg.has_token
                ? "Leave blank to keep existing token"
                : "1234567890:ABCdef..."
            }
            className="w-full rounded-md border border-border bg-input px-3 py-2 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Chat ID */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-foreground">
          Chat ID
        </label>
        <input
          type="text"
          value={chatId}
          onChange={(e) => setChatId(e.target.value)}
          placeholder="-1001234567890"
          className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Notification checkboxes */}
      <div>
        <p className="mb-2 text-xs font-medium text-foreground">Notify on</p>
        <div className="space-y-2">
          {(
            [
              ["notify_new_hosts",      "New live hosts discovered"],
              ["notify_host_changes",   "Host changes detected"],
              ["notify_scan_complete",  "Scan completed"],
              ["notify_errors",         "Scan errors"],
              ["notify_host_gone",      "Host gone / disappeared"],
              ["notify_new_subdomains", "New subdomains discovered"],
              ["notify_takeover",       "Takeover candidate detected"],
            ] as [keyof TelegramSettings, string][]
          ).map(([key, label]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={cfg[key] as boolean}
                onChange={() => setCfg({ ...cfg, [key]: !cfg[key] })}
                className=""
              />
              <span className="text-sm text-foreground">{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <p className={cn("text-xs", testResult.ok ? "text-green-400" : "text-destructive")}>
          {testResult.msg}
        </p>
      )}

      {/* Actions */}
      <div>
        <div className="flex gap-2">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save
          </button>
          <button
            onClick={() => void sendTest()}
            disabled={testing || !cfg.has_token}
            className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {testing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send Test
          </button>
        </div>
      </div>
    </div>
  );
}
