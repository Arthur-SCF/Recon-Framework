import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Eye, Loader2, Plus, Shield, ShieldOff, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import type { ScopeRule, ScopeRuleCreate } from "@/types/api";
import { useActionFetch } from "@/hooks/useActionFetch";

interface Props {
  targetId: string;
}

interface ScopePreviewResult {
  total: number;
  included_count: number;
  excluded_count: number;
  included: string[];
  excluded: string[];
}

export function ScopeRuleEditor({ targetId }: Props) {
  const { actionFetch } = useActionFetch();
  const [rules, setRules] = useState<ScopeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [pattern, setPattern] = useState("");
  const [ruleType, setRuleType] = useState<"include" | "exclude">("include");
  const [adding, setAdding] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<ScopeRule | null>(null);

  // Preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<ScopePreviewResult | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/targets/${targetId}/scope`);
      if (res.ok) setRules((await res.json()) as ScopeRule[]);
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useEffect(() => {
    void fetchRules();
  }, [fetchRules]);

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    if (!pattern.trim()) return;
    setAdding(true);
    try {
      const res = await actionFetch(`/api/v1/targets/${targetId}/scope`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule_type: ruleType,
          pattern: pattern.trim(),
        } satisfies ScopeRuleCreate),
        successMessage: "Scope rule added",
        errorPrefix: "Add scope rule failed",
      });
      if (!res) return;
      const rule = (await res.json()) as ScopeRule;
      setRules((prev) => [...prev, rule]);
      setPattern("");
    } finally {
      setAdding(false);
    }
  }

  async function deleteRule(ruleId: string) {
    const res = await actionFetch(`/api/v1/targets/${targetId}/scope/${ruleId}`, {
      method: "DELETE",
      successMessage: "Scope rule deleted",
      errorPrefix: "Delete scope rule failed",
    });
    if (!res) return;
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    setPendingDelete(null);
  }

  async function openPreview() {
    setPreviewResult(null);
    setPreviewOpen(true);
    setPreviewing(true);
    try {
      const body = rules.map((r) => ({
        rule_type: r.rule_type,
        pattern: r.pattern,
        priority: r.priority ?? 0,
      } satisfies ScopeRuleCreate));
      const res = await actionFetch(`/api/v1/targets/${targetId}/scope/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        errorPrefix: "Scope preview failed",
      });
      if (!res) return;
      setPreviewResult((await res.json()) as ScopePreviewResult);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">Scope Rules</h3>
        {rules.length > 0 && (
          <button
            onClick={() => void openPreview()}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            Preview
          </button>
        )}
      </div>

      {/* Add form */}
      <form onSubmit={(e) => void addRule(e)} className="flex flex-wrap gap-2">
        <div className="flex overflow-hidden rounded-md border border-border">
          {(["include", "exclude"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setRuleType(t)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                ruleType === t
                  ? t === "include"
                    ? "bg-sev-low/15 text-sev-low"
                    : "bg-sev-critical/15 text-sev-critical"
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "include" ? (
                <Shield className="inline h-3 w-3 mr-1" />
              ) : (
                <ShieldOff className="inline h-3 w-3 mr-1" />
              )}
              {t}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="*.staging.example.com"
          className="w-full sm:flex-1 sm:min-w-0 sm:w-auto rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="submit"
          disabled={adding || !pattern.trim()}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {adding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </button>
      </form>

      {/* Rules list */}
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No scope rules — all subdomains are in scope.
        </p>
      ) : (
        <div className="space-y-1">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-md border border-border/50 bg-background px-3 py-2"
            >
              <div className="flex items-center gap-2">
                {r.rule_type === "include" ? (
                  <Shield className="h-3.5 w-3.5 text-sev-low" />
                ) : (
                  <ShieldOff className="h-3.5 w-3.5 text-sev-critical" />
                )}
                <span className="font-mono text-xs text-foreground">
                  {r.pattern}
                </span>
              </div>
              <button
                onClick={() => setPendingDelete(r)}
                className="rounded p-1 text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        itemName={pendingDelete?.pattern ?? ""}
        itemType="scope rule"
        onConfirm={() => { if (pendingDelete) void deleteRule(pendingDelete.id); }}
      />

      {/* Preview modal */}
      <Dialog.Root open={previewOpen} onOpenChange={setPreviewOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-xl focus:outline-none max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-sm font-semibold text-foreground">
                Scope Preview
              </Dialog.Title>
              <Dialog.Close className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            {previewing ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : previewResult ? (
              <div className="space-y-4">
                {/* Summary */}
                <div className="flex gap-4 text-center">
                  <div className="flex-1 rounded-md bg-sev-low/10 px-3 py-2">
                    <p className="font-mono text-lg font-semibold tabular-nums text-sev-low">
                      {previewResult.included_count}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Included</p>
                  </div>
                  <div className="flex-1 rounded-md bg-sev-critical/10 px-3 py-2">
                    <p className="font-mono text-lg font-semibold tabular-nums text-sev-critical">
                      {previewResult.excluded_count}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Excluded</p>
                  </div>
                  <div className="flex-1 rounded-md bg-muted/30 px-3 py-2">
                    <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                      {previewResult.total}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
                  </div>
                </div>

                {/* Lists */}
                <div className="grid grid-cols-2 gap-3">
                  <SubdomainList
                    label="Included"
                    items={previewResult.included}
                    colorClass="text-sev-low"
                  />
                  <SubdomainList
                    label="Excluded"
                    items={previewResult.excluded}
                    colorClass="text-sev-critical"
                  />
                </div>
              </div>
            ) : (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Preview failed.
              </p>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function SubdomainList({
  label,
  items,
  colorClass,
}: {
  label: string;
  items: string[];
  colorClass: string;
}) {
  return (
    <div className="space-y-1">
      <p className={cn("text-xs font-medium", colorClass)}>{label}</p>
      <div className="max-h-48 overflow-y-auto rounded-md border border-border/50 bg-background p-2">
        {items.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((sub) => (
              <li key={sub} className="font-mono text-[10px] text-foreground truncate">
                {sub}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
