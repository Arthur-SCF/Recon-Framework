import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineTemplate } from "@/types/api";

// Static metadata for built-in templates
const BUILTIN_META: Record<
  string,
  { groups: number; steps: number; highlights: string[] }
> = {
  standard: {
    groups: 15,
    steps: 25,
    highlights: ["Passive enum", "DNS brute", "Probing", "Ports", "Takeover"],
  },
  saas: {
    groups: 17,
    steps: 28,
    highlights: ["Cloud enum", "S3 scan", "WAF detect", "Standard tools"],
  },
  corporate: {
    groups: 16,
    steps: 27,
    highlights: ["WAF detect", "Extended ports", "Full pipeline", "Reports"],
  },
  minimal: {
    groups: 5,
    steps: 10,
    highlights: ["Passive only", "Fast", "Low noise", "No brute-force"],
  },
};

function MiniPipelinePreview({
  groups,
  isSelected,
}: {
  groups: number;
  isSelected: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5 mt-2">
      {Array.from({ length: Math.min(groups, 12) }).map((_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors",
              isSelected ? "bg-primary" : "bg-muted-foreground/30",
            )}
          />
          {i < Math.min(groups, 12) - 1 && (
            <div
              className={cn(
                "h-px w-2 transition-colors",
                isSelected ? "bg-primary/40" : "bg-border",
              )}
            />
          )}
        </div>
      ))}
      {groups > 12 && (
        <span className="ml-1 font-mono text-[9px] tabular-nums text-muted-foreground">
          +{groups - 12}
        </span>
      )}
    </div>
  );
}

interface WizardStepTemplateProps {
  template: string;
  onChange: (template: string) => void;
}

export function WizardStepTemplate({
  template,
  onChange,
}: WizardStepTemplateProps) {
  const [templates, setTemplates] = useState<PipelineTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/pipeline/templates")
      .then((r) => r.ok ? r.json() as Promise<PipelineTemplate[]> : Promise.reject())
      .then((data) => { if (!cancelled) setTemplates(data); })
      .catch(() => { /* keep empty list */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <motion.div
      className="space-y-4 py-2"
      initial={{ opacity: 0, x: 200 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -200 }}
      transition={{ duration: 0.2 }}
    >
      <div className="text-center">
        <h3 className="text-base font-semibold text-foreground">
          Choose pipeline template
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Determines which tools run and in what order
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {templates.map((t) => {
            const selected = template === t.name;
            const meta = BUILTIN_META[t.name];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onChange(t.name)}
                className={cn(
                  "rounded-lg border p-4 text-left transition-all",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/40 hover:bg-surface-hover",
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      selected ? "text-primary" : "text-foreground",
                    )}
                  >
                    {t.display_name}
                  </p>
                  {!t.is_default && (
                    <span className="shrink-0 rounded px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide bg-muted/60 text-muted-foreground">
                      custom
                    </span>
                  )}
                </div>
                {t.description && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t.description}
                  </p>
                )}

                {meta ? (
                  <>
                    <MiniPipelinePreview groups={meta.groups} isSelected={selected} />
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {meta.highlights.map((h) => (
                        <span
                          key={h}
                          className={cn(
                            "rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide",
                            selected
                              ? "bg-primary/15 text-primary"
                              : "bg-muted/40 text-muted-foreground",
                          )}
                        >
                          {h}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {meta.groups} groups · {meta.steps} steps
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Custom template
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
