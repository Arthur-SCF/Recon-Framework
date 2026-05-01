import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Upload, ClipboardList, X, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TagInput } from "@/components/TagInput";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { PipelineTemplate } from "@/types/api";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (count: number) => void;
}

interface ImportResult {
  created: number;
  skipped_duplicate: number;
  skipped_invalid: number;
  targets: { id: string; domain: string }[];
}

const DOMAIN_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function parseDomains(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n,]+/)
        .map((s) =>
          s.trim().toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, ""),
        )
        .filter(Boolean),
    ),
  ];
}

export function ImportTargetsDialog({ open, onOpenChange, onImported }: Props) {
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [raw, setRaw] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [template, setTemplate] = useState("standard");
  const [manualOnly, setManualOnly] = useState(false);
  const [templates, setTemplates] = useState<PipelineTemplate[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { actionFetch, pending: loading } = useActionFetch();

  useEffect(() => {
    if (!open) return;
    fetch("/api/v1/pipeline/templates")
      .then((r) => r.ok ? r.json() as Promise<PipelineTemplate[]> : [])
      .then(setTemplates)
      .catch(() => {});
  }, [open]);

  function reset() {
    setRaw("");
    setTags([]);
    setTemplate("standard");
    setManualOnly(false);
    setResult(null);
    setMode("paste");
  }

  function handleClose(isOpen: boolean) {
    onOpenChange(isOpen);
    if (!isOpen) reset();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setRaw((ev.target?.result as string) ?? "");
      setMode("paste"); // switch to paste view to show the parsed content
    };
    reader.readAsText(file);
    // reset input so same file can be re-selected
    e.target.value = "";
  }

  const parsed = parseDomains(raw);
  const validCount = parsed.filter((d) => DOMAIN_RE.test(d) && d.length <= 253).length;
  const invalidCount = parsed.length - validCount;

  async function handleSubmit() {
    if (!parsed.length) return;
    setResult(null);
    const res = await actionFetch("/api/v1/targets/bulk/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domains: parsed,
        pipeline_template: template,
        manual_only: manualOnly,
        tags,
      }),
      errorPrefix: "Import targets",
    });
    if (!res) return;
    const data = (await res.json()) as ImportResult;
    setResult(data);
    if (data.created > 0) onImported(data.created);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-card shadow-2xl outline-none",
          "max-h-[90vh] overflow-y-auto",
        )}>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <Dialog.Title className="text-sm font-semibold text-foreground">
              Import Targets
            </Dialog.Title>
            <Dialog.Close className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div className="p-5 space-y-4">
            {/* Mode tabs */}
            <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
              {(["paste", "upload"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 py-2 transition-colors",
                    mode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/30",
                  )}
                >
                  {m === "paste" ? <ClipboardList className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                  {m === "paste" ? "Paste domains" : "Upload file"}
                </button>
              ))}
            </div>

            {/* Input area */}
            {mode === "paste" ? (
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={"example.com\nhackerone.com\nbugcrowd.com"}
                rows={6}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            ) : (
              <div
                className="flex h-32 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-border hover:border-primary/50 transition-colors"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-6 w-6 text-muted-foreground/40" />
                <p className="mt-2 text-xs text-muted-foreground">
                  Click to upload a <span className="font-medium">.txt</span> or <span className="font-medium">.csv</span> file
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">One domain per line or comma-separated</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
            )}

            {/* Parse preview */}
            {parsed.length > 0 && (
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2.5 text-xs space-y-1.5">
                <p className="font-medium text-foreground">
                  Found {parsed.length} domain{parsed.length !== 1 ? "s" : ""}
                  {invalidCount > 0 && (
                    <span className="ml-2 text-amber-400">· {invalidCount} look invalid</span>
                  )}
                </p>
                <p className="text-muted-foreground font-mono leading-relaxed">
                  {parsed.slice(0, 8).join(", ")}
                  {parsed.length > 8 && <span className="text-muted-foreground/50"> …and {parsed.length - 8} more</span>}
                </p>
              </div>
            )}

            {/* Options */}
            <div className="space-y-3">
              {/* Template */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Pipeline Template
                </label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.display_name}{t.is_default ? "" : " (custom)"}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tags */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground">
                  Tags <span className="font-normal text-muted-foreground">(applied to all)</span>
                </label>
                <TagInput tags={tags} onChange={setTags} placeholder="bug-bounty, high-priority…" />
              </div>

              {/* Manual only toggle */}
              <button
                type="button"
                onClick={() => setManualOnly(!manualOnly)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left transition-all",
                  manualOnly ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <div className={cn(
                  "h-4 w-7 rounded-full border transition-colors relative",
                  manualOnly ? "bg-primary border-primary" : "bg-muted border-border",
                )}>
                  <div className={cn(
                    "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform",
                    manualOnly ? "translate-x-3" : "translate-x-0.5",
                  )} />
                </div>
                <div>
                  <p className={cn("text-xs font-medium", manualOnly ? "text-primary" : "text-foreground")}>
                    Manual Only
                  </p>
                  <p className="text-[10px] text-muted-foreground">Don't auto-schedule these targets</p>
                </div>
              </button>
            </div>

            {/* Result */}
            {result && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs space-y-0.5">
                <div className="flex items-center gap-1.5 font-medium text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Import complete
                </div>
                <p className="text-muted-foreground">
                  {result.created} created
                  {result.skipped_duplicate > 0 && ` · ${result.skipped_duplicate} duplicate${result.skipped_duplicate !== 1 ? "s" : ""} skipped`}
                  {result.skipped_invalid > 0 && ` · ${result.skipped_invalid} invalid skipped`}
                </p>
              </div>
            )}

          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {result ? (
              <button
                onClick={() => handleClose(false)}
                className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            ) : (
              <>
                <Dialog.Close className="rounded border border-border px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Cancel
                </Dialog.Close>
                <button
                  onClick={() => void handleSubmit()}
                  disabled={loading || parsed.length === 0}
                  className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {loading ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing…</>
                  ) : (
                    <>Import {validCount > 0 ? `${validCount} target${validCount !== 1 ? "s" : ""}` : ""}</>
                  )}
                </button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
