import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolHealth {
  step_id:          string;
  name:             string;
  installed:        boolean;
  version:          string | null;
  latest_version:   string | null;
  update_available: boolean;
  path:             string | null;
  error:            string | null;
  checked_at:       string;
}

export function ToolsTab() {
  const [tools,    setTools]    = useState<ToolHealth[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/v1/settings/tools");
      if (res.ok) setTools(await res.json() as ToolHealth[]);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const installed    = tools.filter((t) => t.installed).length;
  const notInstalled = tools.filter((t) => !t.installed).length;
  const outdated     = tools.filter((t) => t.update_available).length;

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {!loading && (
            <>
              <span>
                <span className="text-green-400 font-medium">{installed}</span> installed
                {notInstalled > 0 && (
                  <span>, <span className="text-destructive font-medium">{notInstalled}</span> missing</span>
                )}
                {outdated > 0 && (
                  <span>, <span className="text-amber-400 font-medium">{outdated}</span> update{outdated > 1 ? "s" : ""} available</span>
                )}
              </span>
              {tools.length > 0 && tools[0].checked_at && (
                <p className="text-xs text-muted-foreground mt-1">
                  Last checked: {new Date(tools[0].checked_at).toLocaleString()}
                </p>
              )}
            </>
          )}
        </div>
        <button
          onClick={() => void load()}
          disabled={checking}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", checking && "animate-spin")} />
          Check All
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground w-6"></th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Tool</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Step ID</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Version</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Latest</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Path</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t, i) => (
                <tr
                  key={t.step_id}
                  className={cn(
                    "border-b border-border last:border-0",
                    i % 2 === 0 ? "bg-background" : "bg-muted/10",
                  )}
                >
                  <td className="px-3 py-2">
                    {t.installed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">{t.name}</td>
                  <td className="px-3 py-2 font-mono text-muted-foreground">{t.step_id}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t.version ?? (t.error ? (
                      <span className="text-destructive text-[10px]">{t.error}</span>
                    ) : "—")}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t.latest_version ?? "—"}
                    {t.update_available && (
                      <span className="ml-1.5 rounded px-1 py-0.5 text-[9px] bg-amber-500/20 text-amber-400 font-medium">
                        UPDATE
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground text-[10px]">
                    {t.path ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
