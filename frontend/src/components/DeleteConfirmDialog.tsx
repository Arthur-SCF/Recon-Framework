import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bold name shown in the description */
  itemName: string;
  /** Short label for the item type, e.g. "target", "template", "wordlist" */
  itemType?: string;
  /** Extra detail shown below the item name */
  description?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  itemName,
  itemType = "item",
  description,
  onConfirm,
  loading = false,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[state=closed]:slide-out-to-left-1/2 data-[state=open]:slide-in-from-left-1/2",
          "data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%]",
        )}>
          <Dialog.Close
            disabled={loading}
            className="absolute right-4 top-4 rounded p-1 text-muted-foreground/50 hover:text-muted-foreground disabled:pointer-events-none transition-colors"
          >
            <X className="h-4 w-4" />
          </Dialog.Close>

          <div className="flex flex-col items-center gap-3 pb-2 pt-1 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 ring-1 ring-destructive/20">
              <Trash2 className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground capitalize">
                Delete {itemType}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                You are about to permanently delete{" "}
                <span className="font-medium text-foreground">{itemName}</span>.
                {description && <> {description}</>}
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3.5 py-3 text-xs text-destructive/80">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>This action cannot be undone.</span>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close
              disabled={loading}
              className="rounded border border-border bg-background px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              Cancel
            </Dialog.Close>
            <button
              onClick={() => void onConfirm()}
              disabled={loading}
              className="flex items-center gap-2 rounded bg-destructive px-3.5 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60 transition-colors"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              {loading ? "Deleting…" : `Delete ${itemType}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
