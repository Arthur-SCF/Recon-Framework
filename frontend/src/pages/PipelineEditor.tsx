import { useState } from "react";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { PageTransition } from "@/components/PageTransition";
import { TargetConfig } from "@/components/config/TargetConfig";

export function PipelineEditor() {
  const { id } = useParams<{ id: string }>();
  const [templateName, setTemplateName] = useState("");
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState<{ ok: boolean; text: string } | null>(null);

  async function handleSaveTemplate() {
    if (!id || !templateName.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const resp = await fetch(`/api/v1/targets/${id}/pipeline/save-as-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: templateName.trim() }),
      });
      if (resp.ok) {
        setSaveMsg({ ok: true, text: `Saved as "${templateName.trim()}"` });
        setTemplateName("");
      } else {
        const data = await resp.json().catch(() => ({})) as { detail?: string };
        setSaveMsg({ ok: false, text: data.detail ?? "Failed to save template" });
      }
    } catch {
      setSaveMsg({ ok: false, text: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageTransition>
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto w-full">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Pipeline Editor</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Target: {id}</p>
      </div>

      {id && <TargetConfig targetId={id} />}

      {/* Save as Template */}
      <div className="rounded-lg border border-border p-4 max-w-md">
        <h2 className="text-sm font-semibold text-foreground mb-1">Save as Template</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Save the current pipeline configuration as a reusable template for new targets.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Template name…"
            className="flex-1 rounded-md border border-border bg-input px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            onKeyDown={(e) => { if (e.key === "Enter") void handleSaveTemplate(); }}
          />
          <button
            onClick={() => void handleSaveTemplate()}
            disabled={saving || !templateName.trim()}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
              "disabled:opacity-50",
              saving || !templateName.trim()
                ? "border-border text-muted-foreground"
                : "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20",
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        {saveMsg && (
          <p className={cn(
            "mt-2 flex items-center gap-1 text-xs",
            saveMsg.ok ? "text-sev-low" : "text-destructive",
          )}>
            {saveMsg.ok && <Check className="h-3.5 w-3.5" />}
            {saveMsg.text}
          </p>
        )}
      </div>
    </div>
    </PageTransition>
  );
}
