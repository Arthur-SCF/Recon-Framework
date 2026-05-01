import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, CheckCircle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const now = Date.now();
      // Dedup: skip if same message appeared within the last 1s
      setToasts((prev) => {
        const duplicate = prev.some(
          (t) => t.message === message && now - parseInt(t.id.split("-")[0]!) < 1000
        );
        if (duplicate) return prev;

        const id = `${now}-${Math.random().toString(36).slice(2)}`;
        const next = [...prev, { id, message, type }];
        // Cap at 5, drop the oldest
        const capped = next.length > 5 ? next.slice(next.length - 5) : next;

        // Schedule auto-dismiss
        setTimeout(() => removeToast(id), 4000);
        return capped;
      });
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-auto z-50 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100 }}
              transition={{ duration: 0.2 }}
            >
              <ToastItem toast={toast} onClose={() => removeToast(toast.id)} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon =
    toast.type === "success"
      ? CheckCircle
      : toast.type === "error"
        ? AlertCircle
        : Info;

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg",
        "w-full sm:w-auto sm:min-w-[280px] sm:max-w-[380px]",
        toast.type === "success" && "border-l-4 border-l-emerald-500 border-border/50",
        toast.type === "error"   && "border-l-4 border-l-destructive border-border/50",
        toast.type === "info"    && "border-l-4 border-l-primary border-border/50"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          toast.type === "success" && "text-emerald-500",
          toast.type === "error"   && "text-destructive",
          toast.type === "info"    && "text-primary"
        )}
      />
      <p className="flex-1 text-sm text-foreground">{toast.message}</p>
      <button
        onClick={onClose}
        className="ml-1 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
