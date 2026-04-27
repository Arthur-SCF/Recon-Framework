/**
 * FieldRenderer — renders a single ParamDescriptor as the appropriate input.
 *
 * Supported types:
 *   int / float — NumberInput with optional min/max/unit
 *   bool        — checkbox toggle
 *   string      — text input
 *   enum        — <select>
 *   csv         — comma-separated tag textarea (simplified: plain textarea)
 *   kv          — key=value textarea (one pair per line)
 *   textarea    — multi-line text
 *   secret      — type="password" input
 */
import { cn } from "@/lib/utils";
import type { ParamDescriptor } from "./useParamSchema";
import { InfoTooltip } from "../InfoTooltip";

interface Props {
  descriptor: ParamDescriptor;
  value:      unknown;
  onChange:   (key: string, value: unknown) => void;
  disabled?:  boolean;
}

export function FieldRenderer({ descriptor, value, onChange, disabled }: Props) {
  const { key, label, type, unit, options, tooltip, min, max, step } = descriptor;
  const val = value ?? descriptor.default;

  function emit(v: unknown) {
    onChange(key, v);
  }

  return (
    <div className="flex items-start gap-2 min-h-[28px]">
      {/* Label */}
      <span className="w-36 shrink-0 text-xs text-muted-foreground leading-7">
        {label}
      </span>

      {/* Input */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {type === "bool" ? (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={!!val}
              disabled={disabled}
              onChange={e => emit(e.target.checked)}
              className="accent-primary h-3.5 w-3.5"
            />
          </label>
        ) : type === "enum" ? (
          <select
            value={String(val ?? "")}
            disabled={disabled}
            onChange={e => emit(e.target.value)}
            className={cn(
              "rounded border border-border bg-background px-2 py-1 text-xs text-foreground",
              "focus:outline-none focus:ring-1 focus:ring-primary",
              "disabled:opacity-50"
            )}
          >
            {(options ?? []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
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
            rows={3}
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
              type === "csv" ? "value1,value2,value3" :
              ""
            }
            className={cn(
              "flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground",
              "focus:outline-none focus:ring-1 focus:ring-primary resize-none",
              "disabled:opacity-50 font-mono"
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
              "flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground",
              "focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            )}
          />
        ) : (
          /* int / float / string */
          <input
            type={type === "string" ? "text" : "number"}
            value={String(val ?? "")}
            disabled={disabled}
            min={min}
            max={max}
            step={step ?? (type === "float" ? 0.1 : 1)}
            onChange={e => {
              const raw = e.target.value;
              if (type === "int")   emit(raw === "" ? "" : parseInt(raw, 10));
              else if (type === "float") emit(raw === "" ? "" : parseFloat(raw));
              else emit(raw);
            }}
            className={cn(
              "w-24 rounded border border-border bg-background px-2 py-1 text-xs text-foreground",
              "focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
            )}
          />
        )}

        {/* Unit */}
        {unit && type !== "bool" && type !== "textarea" && type !== "csv" && type !== "kv" && (
          <span className="text-xs text-muted-foreground shrink-0">{unit}</span>
        )}

        {/* Tooltip */}
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
    </div>
  );
}
