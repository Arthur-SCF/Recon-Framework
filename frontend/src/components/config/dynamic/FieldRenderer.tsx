/**
 * FieldRenderer — renders a single ParamDescriptor as the appropriate input.
 *
 * Layout:
 *   bool   — horizontal row: [label + description] [Switch]
 *   others — vertical stack: label row (+ Reset when modified), description, input, range hint
 *
 * Modified state: left accent border + "Reset" button when value ≠ default.
 * Description (tooltip text) always visible below label — no hover required.
 */
import { ChevronDown, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ParamDescriptor } from "./useParamSchema";
import { Switch } from "@/components/ui/switch";

interface Props {
  descriptor: ParamDescriptor;
  value:      unknown;
  onChange:   (key: string, value: unknown) => void;
  disabled?:  boolean;
}

function isValueModified(value: unknown, defaultVal: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value === "object" || typeof defaultVal === "object") {
    return JSON.stringify(value) !== JSON.stringify(defaultVal ?? null);
  }
  return value !== defaultVal;
}

export function FieldRenderer({ descriptor, value, onChange, disabled }: Props) {
  const { key, label, type, unit, options, tooltip, min, max, step } = descriptor;
  const defaultVal = descriptor.default;
  const val = value ?? defaultVal;
  const modified = isValueModified(value, defaultVal);

  function emit(v: unknown) { onChange(key, v); }
  function reset() { onChange(key, undefined); }

  // ── Bool — horizontal layout ───────────────────────────────────────────────
  if (type === "bool") {
    return (
      <div className={cn(
        "flex items-start justify-between gap-4 py-2 rounded-md transition-colors",
        modified && "border-l-2 border-primary/60 pl-2 -ml-2",
      )}>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground leading-snug">{label}</p>
          {tooltip && (
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{tooltip}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          {modified && (
            <button
              onClick={reset}
              title="Reset to default"
              className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          <Switch
            checked={!!val}
            onCheckedChange={v => emit(v)}
            disabled={disabled}
          />
        </div>
      </div>
    );
  }

  // ── All other types — vertical layout ─────────────────────────────────────
  return (
    <div className={cn(
      "flex flex-col gap-1 transition-colors",
      modified && "border-l-2 border-primary/60 pl-2 -ml-2",
    )}>

      {/* Label row */}
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-foreground leading-snug">{label}</label>
        {modified && (
          <button
            onClick={reset}
            title="Reset to default"
            className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors shrink-0"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            Reset
          </button>
        )}
      </div>

      {/* Description — always visible */}
      {tooltip && (
        <p className="text-[10px] text-muted-foreground leading-snug">{tooltip}</p>
      )}

      {/* Input */}
      {type === "enum" ? (
        <div className="relative">
          <select
            value={String(val ?? "")}
            disabled={disabled}
            onChange={e => emit(e.target.value)}
            className={cn(
              "w-full appearance-none rounded-md border border-border bg-background",
              "pl-2.5 pr-7 py-1.5 text-xs text-foreground",
              "focus:outline-none focus:ring-1 focus:ring-primary",
              "disabled:opacity-50 transition-colors",
            )}
          >
            {(options ?? []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        </div>

      ) : type === "textarea" || type === "csv" || type === "kv" ? (
        <textarea
          value={
            type === "kv" && val && typeof val === "object"
              ? Object.entries(val as Record<string, string>)
                  .map(([k, v]) => `${k}=${v}`)
                  .join("\n")
              : String(val ?? "")
          }
          disabled={disabled}
          rows={type === "kv" ? 4 : 3}
          onChange={e => {
            if (type === "kv") {
              const kv: Record<string, string> = {};
              for (const line of e.target.value.split("\n")) {
                const idx = line.indexOf("=");
                if (idx > 0) kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
              }
              emit(kv);
            } else {
              emit(e.target.value);
            }
          }}
          placeholder={
            type === "kv"  ? "Header-Name=value\nAnother=val" :
            type === "csv" ? "value1, value2, value3" :
            ""
          }
          className={cn(
            "w-full rounded-md border border-border bg-background px-2.5 py-1.5",
            "text-xs text-foreground font-mono placeholder:text-muted-foreground/50",
            "focus:outline-none focus:ring-1 focus:ring-primary",
            "disabled:opacity-50 resize-none transition-colors",
          )}
        />

      ) : type === "secret" ? (
        <input
          type="password"
          value={String(val ?? "")}
          disabled={disabled}
          onChange={e => emit(e.target.value)}
          autoComplete="off"
          className={cn(
            "w-full rounded-md border border-border bg-background px-2.5 py-1.5",
            "text-xs text-foreground placeholder:text-muted-foreground/50",
            "focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50",
          )}
        />

      ) : type === "int" || type === "float" ? (
        /* Number with optional inline unit suffix */
        <div className={cn(
          "flex items-stretch rounded-md border border-border bg-background",
          "focus-within:ring-1 focus-within:ring-primary overflow-hidden transition-colors",
          disabled && "opacity-50",
        )}>
          <input
            type="number"
            value={String(val ?? "")}
            disabled={disabled}
            min={min}
            max={max}
            step={step ?? (type === "float" ? 0.1 : 1)}
            onChange={e => {
              const raw = e.target.value;
              if (type === "int")   emit(raw === "" ? "" : parseInt(raw, 10));
              else                  emit(raw === "" ? "" : parseFloat(raw));
            }}
            className="flex-1 min-w-0 bg-transparent px-2.5 py-1.5 font-mono text-xs tabular-nums text-foreground focus:outline-none"
          />
          {unit && (
            <span className={cn(
              "shrink-0 flex items-center px-2.5 border-l border-border",
              "bg-muted/30 font-mono text-[10px] text-muted-foreground",
            )}>
              {unit}
            </span>
          )}
        </div>

      ) : (
        /* string */
        <input
          type="text"
          value={String(val ?? "")}
          disabled={disabled}
          onChange={e => emit(e.target.value)}
          className={cn(
            "w-full rounded-md border border-border bg-background px-2.5 py-1.5",
            "text-xs text-foreground placeholder:text-muted-foreground/50",
            "focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50",
          )}
        />
      )}

      {/* Range hint for numbers */}
      {(type === "int" || type === "float") && (min !== undefined || max !== undefined) && (
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground/50">
          {min !== undefined && max !== undefined
            ? `${min} – ${max}${unit ? ` ${unit}` : ""}`
            : min !== undefined
              ? `min ${min}${unit ? ` ${unit}` : ""}`
              : `max ${max}${unit ? ` ${unit}` : ""}`}
        </p>
      )}
    </div>
  );
}
