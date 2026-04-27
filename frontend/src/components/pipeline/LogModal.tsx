import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogModalProps {
  targetId: string;
  sessionId: string;
  stepId: string;
  /** Optional duration in seconds to show in the header */
  durationSeconds?: number | null;
  onClose: () => void;
}

// ── ANSI color support ────────────────────────────────────────────────────────

const SGR_COLOR_MAP: Record<string, string> = {
  "0":  "",
  "1":  "font-bold",
  "30": "text-gray-500",
  "31": "text-red-400",
  "32": "text-green-400",
  "33": "text-yellow-400",
  "34": "text-blue-400",
  "35": "text-purple-400",
  "36": "text-cyan-400",
  "37": "text-foreground",
  "90": "text-gray-400",
  "91": "text-red-300",
  "92": "text-green-300",
  "93": "text-yellow-300",
  "94": "text-blue-300",
  "95": "text-purple-300",
  "96": "text-cyan-300",
};

// Split text on ESC[...m sequences, return spans with Tailwind color classes
function ansiToSpans(text: string): React.ReactNode[] {
  const ESC_RE = /\x1b\[([0-9;]*)m/g;
  const parts: React.ReactNode[] = [];
  let currentClass = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = ESC_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const segment = text.slice(lastIndex, match.index);
      parts.push(
        currentClass
          ? <span key={key++} className={currentClass}>{segment}</span>
          : segment,
      );
    }
    const codes = match[1].split(";");
    const classes: string[] = [];
    for (const code of codes) {
      const cls = SGR_COLOR_MAP[code];
      if (cls !== undefined) {
        if (code === "0") { classes.length = 0; }
        else if (cls) classes.push(cls);
      }
    }
    currentClass = classes.join(" ");
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex);
    parts.push(
      currentClass
        ? <span key={key++} className={currentClass}>{tail}</span>
        : tail,
    );
  }

  return parts;
}

// Highlight a search match within a single line of plain text
function highlightLine(line: string, query: string): React.ReactNode {
  if (!query) return line;
  const idx = line.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return line;
  return (
    <>
      {line.slice(0, idx)}
      <mark className="bg-yellow-400/30 text-yellow-300 rounded-sm px-0.5">
        {line.slice(idx, idx + query.length)}
      </mark>
      {line.slice(idx + query.length)}
    </>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LogModal({
  targetId, sessionId, stepId, durationSeconds, onClose,
}: LogModalProps) {
  const [content, setContent]       = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch(
      `/api/v1/targets/${targetId}/sessions/${sessionId}/steps/${stepId}/stdout`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { content: string }) => setContent(d.content))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [targetId, sessionId, stepId]);

  useEffect(() => {
    if (autoScroll && scrollRef.current && content) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, autoScroll]);

  function handleDownload() {
    if (!content) return;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${stepId}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const lines = content ? content.split("\n") : [];
  const filteredLines = filter
    ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : lines;
  const lineCount = lines.length;
  const sizeKB = content ? (content.length / 1024).toFixed(1) : "0";
  const matchCount = filter ? filteredLines.length : null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="relative w-full max-w-3xl max-h-[85vh] m-4 rounded-lg border border-border bg-background flex flex-col shadow-xl"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <span className="font-mono text-sm font-medium text-foreground shrink-0">{stepId}</span>
            {!loading && content && (
              <span className="text-xs text-muted-foreground">
                {lineCount.toLocaleString()} lines · {sizeKB} KB
                {durationSeconds != null && ` · ran ${durationSeconds}s`}
              </span>
            )}
            <div className="flex-1" />
            {content && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                title="Download log"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Search bar */}
          {content && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter output…"
                className="flex-1 bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              />
              {filter && (
                <>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {matchCount} match{matchCount !== 1 ? "es" : ""}
                  </span>
                  <button
                    onClick={() => setFilter("")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Content */}
          <div ref={scrollRef} className="flex-1 overflow-auto p-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : content === null ? (
              <p className="text-sm text-muted-foreground">No output available.</p>
            ) : filter && filteredLines.length === 0 ? (
              <p className="text-xs text-muted-foreground">No lines match "{filter}"</p>
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap text-foreground leading-relaxed">
                {filter
                  ? filteredLines.map((line, i) => (
                      <span key={i}>{highlightLine(line, filter)}{"\n"}</span>
                    ))
                  : ansiToSpans(content)
                }
              </pre>
            )}
          </div>

          {/* Footer */}
          {content && (
            <div className="flex items-center gap-2 border-t border-border px-4 py-2">
              <label className={cn(
                "flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground select-none",
              )}>
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => {
                    setAutoScroll(e.target.checked);
                    if (e.target.checked && scrollRef.current) {
                      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    }
                  }}
                  className="h-3 w-3"
                />
                Auto-scroll
              </label>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
