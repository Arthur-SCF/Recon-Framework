/**
 * DynamicParamForm — schema-driven replacement for all hand-written param
 * components in components/config/params/*.tsx
 *
 * Props match the existing PARAM_COMPONENTS contract so it can be dropped in
 * as a direct replacement:
 *   stepId: string
 *   overrides: Record<string, unknown>
 *   onChange: (o: Record<string, unknown>) => void
 *
 * Progressive disclosure:
 *   basic   → rendered inline, always visible
 *   advanced → behind "Advanced ▸" collapsible (closed by default)
 *   danger  → behind "Danger zone" accordion; shows amber warning before
 *              the field is revealed (user must click to expand)
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useParamSchema, type ParamDescriptor } from "./useParamSchema";
import { FieldRenderer } from "./FieldRenderer";

interface Props {
  stepId:    string;
  overrides: Record<string, unknown>;
  onChange:  (o: Record<string, unknown>) => void;
  disabled?: boolean;
}

export function DynamicParamForm({ stepId, overrides, onChange, disabled }: Props) {
  const { schema, loading } = useParamSchema(stepId);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [dangerOpen,   setDangerOpen]   = useState(false);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading params…
      </div>
    );
  }

  if (schema.length === 0) {
    return (
      <p className="py-2 text-xs text-muted-foreground/50 italic">
        No configurable parameters.
      </p>
    );
  }

  const basic    = schema.filter(p => !p.bucket || p.bucket === "basic");
  const advanced = schema.filter(p => p.bucket === "advanced");
  const danger   = schema.filter(p => p.bucket === "danger");

  function handleChange(key: string, value: unknown) {
    onChange({ ...overrides, [key]: value });
  }

  function renderFields(fields: ParamDescriptor[]) {
    return fields.map(desc => (
      <FieldRenderer
        key={desc.key}
        descriptor={desc}
        value={overrides[desc.key]}
        onChange={handleChange}
        disabled={disabled}
      />
    ));
  }

  return (
    <div className="flex flex-col gap-2 py-1.5">

      {/* Basic fields */}
      {renderFields(basic)}

      {/* Advanced section */}
      {advanced.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setAdvancedOpen(v => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {advancedOpen
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />}
            Advanced
          </button>
          {advancedOpen && (
            <div className="mt-2 pl-3 border-l border-border/50 flex flex-col gap-2">
              {renderFields(advanced)}
            </div>
          )}
        </div>
      )}

      {/* Danger zone */}
      {danger.length > 0 && (
        <div className="mt-1 rounded border border-amber-500/30 bg-amber-500/5">
          <button
            type="button"
            onClick={() => setDangerOpen(v => !v)}
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-amber-500 hover:text-amber-400 transition-colors"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="flex-1 text-left">Danger zone</span>
            {dangerOpen
              ? <ChevronDown className="h-3 w-3 shrink-0" />
              : <ChevronRight className="h-3 w-3 shrink-0" />}
          </button>
          {dangerOpen && (
            <div className={cn(
              "px-2.5 pb-2.5 flex flex-col gap-2",
              "border-t border-amber-500/20"
            )}>
              <p className="text-[10px] text-amber-500/80 pt-1.5 leading-snug">
                These settings can cause rate-limiting, IDS alerts, or scan failures.
                Change only if you know what you're doing.
              </p>
              {renderFields(danger)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
