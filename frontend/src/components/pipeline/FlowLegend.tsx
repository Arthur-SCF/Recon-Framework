import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  MinusCircle,
  Clock,
} from "lucide-react";

const items = [
  { icon: <Circle        className="h-3 w-3 text-muted-foreground/40" />, label: "Pending"  },
  { icon: <Loader2       className="h-3 w-3 text-sev-info"            />, label: "Running"  },
  { icon: <CheckCircle2  className="h-3 w-3 text-sev-low"            />, label: "Success"  },
  { icon: <AlertCircle   className="h-3 w-3 text-sev-critical"       />, label: "Error"    },
  { icon: <Clock         className="h-3 w-3 text-sev-medium"         />, label: "Timeout"  },
  { icon: <MinusCircle   className="h-3 w-3 text-faint-foreground"   />, label: "Skipped"  },
];

export function FlowLegend() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 max-w-full rounded-lg border border-border bg-card px-2.5 py-1.5">
      {items.map(({ icon, label }) => (
        <span key={label} className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap">
          {icon}
          {label}
        </span>
      ))}
    </div>
  );
}
