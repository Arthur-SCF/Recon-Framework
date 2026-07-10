import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X, Link2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { Target, ProgramAssignResult } from "@/types/api";

interface Props {
  programId: string;
  open: boolean;
  onClose: () => void;
  onAssigned: (result: ProgramAssignResult) => void;
}

type ConfigSource = "inherit" | "override";

const CONFIG_CARDS: { id: ConfigSource; label: string; desc: string }[] = [
  { id: "inherit",  label: "Inherit",  desc: "use the program's default scan config" },
  { id: "override", label: "Override", desc: "keep each asset's own config" },
];

export function AssignAssetsModal({ programId, open, onClose, onAssigned }: Props) {
  const [targets, setTargets]         = useState<Target[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [configSource, setConfigSource] = useState<ConfigSource>("inherit");
  const [q, setQ]                     = useState("");

  const { actionFetch, pending } = useActionFetch();

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setConfigSource("inherit");
    setQ("");
    setLoading(true);
    let cancelled = false;
    fetch("/api/v1/targets")
      .then((r) => (r.ok ? r.json() as Promise<Target[]> : Promise.reject()))
      .then((data) => { if (!cancelled) setTargets(data.filter((t) => t.program_id === null)); })
      .catch(() => { if (!cancelled) setTargets([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const filtered = q
    ? targets.filter((t) => t.domain.toLowerCase().includes(q.toLowerCase()))
    : targets;

  function toggle(id: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  const handleAssign = async () => {
    if (!selected.size) return;
    const res = await actionFetch(`/api/v1/programs/${programId}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ids: [...selected], config_source: configSource }),
      successMessage: `${selected.size} asset${selected.size !== 1 ? "s" : ""} assigned`,
      errorPrefix: "Assign assets",
    });
    if (!res) return;
    const result = (await res.json()) as ProgramAssignResult;
    onAssigned(result);
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!pending && !o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[state=closed]:slide-out-to-left-1/2 data-[state=open]:slide-in-from-left-1/2",
          "data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%]",
          "max-h-[90vh] overflow-y-auto",
        )}>
          <Dialog.Close
            disabled={pending}
            className="absolute right-4 top-4 rounded p-1 text-muted-foreground/50 hover:text-muted-foreground disabled:pointer-events-none transition-colors"
          >
            <X className="h-4 w-4" />
          </Dialog.Close>

          <div className="mb-5 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Link2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">Assign Assets</Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">
                Add standalone targets as assets of this program
              </Dialog.Description>
            </div>
          </div>

          {/* Config source */}
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-foreground">Config source</label>
            <div className="grid grid-cols-2 gap-2">
              {CONFIG_CARDS.map((c) => {
                const sel = configSource === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setConfigSource(c.id)}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-all",
                      sel ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40",
                    )}
                  >
                    <span className={cn("text-xs font-medium", sel ? "text-primary" : "text-foreground")}>{c.label}</span>
                    <span className="text-[10px] leading-tight text-muted-foreground">{c.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter targets…"
              className="w-full rounded border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Target list */}
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                {targets.length === 0 ? "No standalone targets available." : "No targets match the filter."}
              </p>
            ) : (
              filtered.map((t) => {
                const sel = selected.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2 text-left last:border-0 transition-colors",
                      sel ? "bg-primary/5" : "hover:bg-muted/20",
                    )}
                  >
                    <span className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      sel ? "border-primary bg-primary" : "border-border",
                    )}>
                      {sel && (
                        <svg className="h-3 w-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="font-mono text-xs text-foreground truncate">{t.domain}</span>
                  </button>
                );
              })
            )}
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{selected.size} selected</span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                disabled={pending}
                className="rounded border border-border bg-background px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleAssign()}
                disabled={pending || selected.size === 0}
                className="flex items-center gap-2 rounded bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {pending ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Assigning…</> : <>Assign</>}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
