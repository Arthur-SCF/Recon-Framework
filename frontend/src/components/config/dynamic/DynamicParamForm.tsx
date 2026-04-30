/**
 * DynamicParamForm — schema-driven param editor.
 *
 * Progressive disclosure:
 *   basic    → always visible
 *   advanced → behind "Advanced" collapsible
 *   danger   → behind "Danger zone" collapsible with amber warning
 *
 * Modified tracking: shows "N modified" count + "Reset all" when overrides exist.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Loader2, RotateCcw } from "lucide-react";
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
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading parameters…
      </div>
    );
  }

  if (schema.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground/50 italic">
        No configurable parameters.
      </p>
    );
  }

  const basic    = schema.filter(p => !p.bucket || p.bucket === "basic");
  const advanced = schema.filter(p => p.bucket === "advanced");
  const danger   = schema.filter(p => p.bucket === "danger");

  const modifiedCount = Object.keys(overrides).length;

  function handleChange(key: string, value: unknown) {
    onChange({ ...overrides, [key]: value });
  }

  function resetAll() {
    onChange({});
  }

  function renderFields(fields: ParamDescriptor[]) {
    // Render with optional group dividers
    const result: React.ReactNode[] = [];
    let lastGroup = "";

    for (const desc of fields) {
      const currentGroup = desc.group ?? "";
      if (currentGroup && currentGroup !== lastGroup) {
        result.push(
          <div key={`group-${currentGroup}`} className="flex items-center gap-2 pt-1">
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
              {currentGroup}
            </span>
            <div className="flex-1 h-px bg-border/50" />
          </div>
        );
        lastGroup = currentGroup;
      }
      result.push(
        <FieldRenderer
          key={desc.key}
          descriptor={desc}
          value={overrides[desc.key]}
          onChange={handleChange}
          disabled={disabled}
        />
      );
    }

    return result;
  }

  return (
    <div className="flex flex-col gap-0.5">

      {/* Modified summary + reset all */}
      {modifiedCount > 0 && (
        <div className="flex items-center justify-between mb-2 pb-2 border-b border-border/50">
          <span className="text-[10px] text-primary/70">
            {modifiedCount} {modifiedCount === 1 ? "param" : "params"} modified
          </span>
          <button
            onClick={resetAll}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Reset all
          </button>
        </div>
      )}

      {/* Basic fields */}
      <div className="flex flex-col gap-3">
        {renderFields(basic)}
      </div>

      {/* Advanced section */}
      {advanced.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setAdvancedOpen(v => !v)}
            className="flex items-center gap-2 w-full group"
          >
            <div className="flex-1 h-px bg-border/50 group-hover:bg-border transition-colors" />
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
              Advanced
              {advancedOpen
                ? <ChevronDown className="h-3 w-3" />
                : <ChevronRight className="h-3 w-3" />}
            </span>
            <div className="flex-1 h-px bg-border/50 group-hover:bg-border transition-colors" />
          </button>

          {advancedOpen && (
            <div className="mt-3 flex flex-col gap-3">
              {renderFields(advanced)}
            </div>
          )}
        </div>
      )}

      {/* Danger zone */}
      {danger.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 overflow-hidden">
          <button
            type="button"
            onClick={() => setDangerOpen(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-amber-500/80 hover:text-amber-400 hover:bg-amber-500/5 transition-colors"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="flex-1 text-left font-medium">Danger zone</span>
            {dangerOpen
              ? <ChevronDown className="h-3 w-3 shrink-0" />
              : <ChevronRight className="h-3 w-3 shrink-0" />}
          </button>

          {dangerOpen && (
            <div className="px-3 pb-3 flex flex-col gap-3 border-t border-amber-500/20">
              <p className="text-[10px] text-amber-500/70 pt-2 leading-snug">
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
