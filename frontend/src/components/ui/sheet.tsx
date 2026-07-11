/**
 * Sheet — compact floating param editor card with frosted-glass effect.
 * Replaces the old full-height slide-in panel.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open:         boolean;
  onClose:      () => void;
  title?:       string;
  subtitle?:    string;
  children:     React.ReactNode;
  className?:   string;
  /** Optional hex color for category-aware accent (header tint + top bar). */
  accentColor?: string;
}

export function Sheet({
  open, onClose, title, subtitle, children, className, accentColor,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — minimal blur, semi-transparent */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Floating card */}
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1,    y: 0 }}
            exit={{    opacity: 0, scale: 0.94, y: 8 }}
            transition={{ type: "spring", damping: 28, stiffness: 380 }}
            className={cn(
              "fixed z-50 flex flex-col",
              "left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2",
              "w-80 max-h-[calc(100vh-5rem)]",
              "rounded-lg overflow-hidden",
              "bg-card/90 backdrop-blur-2xl",
              "border border-border",
              "shadow-2xl",
              className,
            )}
          >
            {/* Accent bar — top gradient line */}
            <div
              className="h-px w-full shrink-0"
              style={accentColor
                ? { background: `linear-gradient(to right, transparent, ${accentColor}99, transparent)` }
                : { background: "linear-gradient(to right, transparent, color-mix(in srgb, var(--primary) 50%, transparent), transparent)" }
              }
            />

            {/* Header */}
            {title && (
              <div
                className="flex items-start justify-between gap-3 px-4 py-3 shrink-0 border-b border-border"
                style={accentColor
                  ? { background: `linear-gradient(to bottom, ${accentColor}12, transparent)` }
                  : { background: "linear-gradient(to bottom, color-mix(in srgb, var(--primary) 6%, transparent), transparent)" }
                }
              >
                <div className="min-w-0 flex-1">
                  {/* Category dot + title */}
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={accentColor
                        ? { backgroundColor: `${accentColor}cc` }
                        : { backgroundColor: "color-mix(in srgb, var(--primary) 60%, transparent)" }
                      }
                    />
                    <h2 className="text-xs font-semibold text-foreground/90 truncate">
                      {title}
                    </h2>
                  </div>

                  {subtitle && (
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground pl-3.5">
                      {subtitle === "saving…" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                      {subtitle}
                    </p>
                  )}
                </div>

                <button
                  onClick={onClose}
                  className="shrink-0 p-1 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-surface-hover transition-colors"
                  aria-label="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
