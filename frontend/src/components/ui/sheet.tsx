/**
 * Sheet — a slide-in panel built on top of a Radix-style dialog + framer-motion.
 *
 * Usage:
 *   <Sheet open={open} onClose={() => setOpen(false)} title="Edit params">
 *     {children}
 *   </Sheet>
 *
 * On mobile (<640px) it slides up from the bottom (drawer behaviour).
 * On desktop it slides in from the right.
 */
import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open:     boolean;
  onClose:  () => void;
  title?:   string;
  children: React.ReactNode;
  /** Extra classes for the panel container */
  className?: string;
  /** If true, panel takes full-height on desktop (default: auto height from bottom) */
  fullHeight?: boolean;
}

export function Sheet({
  open, onClose, title, children, className, fullHeight = true,
}: SheetProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll when sheet is open
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else       document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel — right side on md+, bottom on mobile */}
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className={cn(
              "fixed right-0 top-0 z-50 flex flex-col",
              "w-full max-w-md bg-card border-l border-border shadow-2xl",
              fullHeight ? "h-full" : "h-auto min-h-[50vh] max-h-full",
              className
            )}
          >
            {/* Header */}
            {title && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
                <button
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted/30"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
