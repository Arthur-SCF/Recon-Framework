import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  MinusCircle,
  Clock,
} from "lucide-react";

const items = [
  { icon: <Circle        className="h-3 w-3 text-muted-foreground/25" />, label: "Pending"  },
  { icon: <Loader2       className="h-3 w-3 text-blue-400"            />, label: "Running"  },
  { icon: <CheckCircle2  className="h-3 w-3 text-green-400"           />, label: "Success"  },
  { icon: <AlertCircle   className="h-3 w-3 text-red-400"             />, label: "Error"    },
  { icon: <Clock         className="h-3 w-3 text-yellow-400"          />, label: "Timeout"  },
  { icon: <MinusCircle   className="h-3 w-3 text-muted-foreground/25" />, label: "Skipped"  },
];

export function FlowLegend() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-card/60 backdrop-blur-sm px-3 py-1.5 shadow-sm shadow-black/20">
      {items.map(({ icon, label }) => (
        <span key={label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
          {icon}
          {label}
        </span>
      ))}
    </div>
  );
}
