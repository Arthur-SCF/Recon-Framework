import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SECTIONS: { label: string; shortcuts: ShortcutRow[] }[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: ["/"],       description: "Focus global search" },
      { keys: ["n"],       description: "New target" },
      { keys: ["?"],       description: "Show this help" },
      { keys: ["Esc"],     description: "Close modal / blur input" },
    ],
  },
  {
    label: "Target Detail (tabs)",
    shortcuts: [
      { keys: ["1"],       description: "Overview tab" },
      { keys: ["2"],       description: "Subdomains tab" },
      { keys: ["3"],       description: "Live Hosts tab" },
      { keys: ["4"],       description: "Ports tab" },
      { keys: ["5"],       description: "Screenshots tab" },
      { keys: ["6"],       description: "Takeovers tab" },
      { keys: ["7"],       description: "Cloud tab" },
      { keys: ["8"],       description: "History tab" },
    ],
  },
  {
    label: "Scan Control",
    shortcuts: [
      { keys: ["s"],       description: "Start scan" },
      { keys: ["p"],       description: "Pause / resume scan" },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground min-w-[1.5rem]">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsModal({ open, onClose }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-lg border border-border bg-card shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <Dialog.Title className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <span className="text-sm font-semibold text-foreground">Keyboard Shortcuts</span>
            <Dialog.Close className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </Dialog.Title>

          <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
            {SECTIONS.map((section) => (
              <div key={section.label}>
                <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
                  {section.label}
                </p>
                <div className="space-y-1.5">
                  {section.shortcuts.map(({ keys, description }) => (
                    <div key={description} className="flex items-center justify-between gap-4">
                      <span className="text-xs text-foreground">{description}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border px-5 py-3 text-[10px] text-muted-foreground/70">
            Shortcuts are disabled while typing in input fields.
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
