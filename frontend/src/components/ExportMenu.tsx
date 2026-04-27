import { useEffect, useRef, useState } from "react";
import { Download, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExportMenuProps {
  targetId: string;
  type: "subdomains" | "hosts" | "diff" | "ports" | "takeovers" | "cloud" | "screenshots";
  sessionId?: string;
  params?: Record<string, string>;
}

export function ExportMenu({ targetId, type, sessionId, params }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function download(format: "csv" | "json") {
    const qs = new URLSearchParams({ format });
    if (sessionId) qs.set("session", sessionId);
    if (params) Object.entries(params).forEach(([k, v]) => qs.set(k, v));
    window.open(`/api/v1/targets/${targetId}/export/${type}?${qs}`, "_blank", "noopener");
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1 h-8 rounded-md border border-border px-2 text-xs",
          "text-muted-foreground hover:text-foreground transition-colors bg-background",
        )}
      >
        <Download className="h-3.5 w-3.5" />
        Export
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 w-28 rounded-md border border-border bg-background shadow-md">
          <button
            onClick={() => download("csv")}
            className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors rounded-t-md"
          >
            CSV
          </button>
          <button
            onClick={() => download("json")}
            className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors rounded-b-md border-t border-border"
          >
            JSON
          </button>
        </div>
      )}
    </div>
  );
}
