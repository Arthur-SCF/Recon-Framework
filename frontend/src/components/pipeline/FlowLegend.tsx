import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  MinusCircle,
  Clock,
} from "lucide-react";

const items = [
  { icon: <Circle        className="h-3.5 w-3.5 text-muted-foreground/25" />, label: "Pending"  },
  { icon: <Loader2       className="h-3.5 w-3.5 text-blue-400"            />, label: "Running"  },
  { icon: <CheckCircle2  className="h-3.5 w-3.5 text-green-400"           />, label: "Success"  },
  { icon: <AlertCircle   className="h-3.5 w-3.5 text-red-400"             />, label: "Error"    },
  { icon: <Clock         className="h-3.5 w-3.5 text-yellow-400"          />, label: "Timeout"  },
  { icon: <MinusCircle   className="h-3.5 w-3.5 text-muted-foreground/25" />, label: "Skipped"  },
];

export function FlowLegend() {
  return (
    <div className="flex items-center gap-4 text-[10px] text-muted-foreground/40">
      {items.map(({ icon, label }) => (
        <span key={label} className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
      ))}
    </div>
  );
}
