import { Link } from "react-router-dom";
import { ArrowUpRight, Boxes, FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";

interface TargetGroupHeaderProps {
  /** Program name, or the standalone-section label */
  name: string;
  /** Number of visible targets in this group */
  count: number;
  /** Program id when this band heads a program group; null/undefined = standalone */
  programId?: string | null;
}

/**
 * Hairline header band for a Dashboard target group — an operator-panel label:
 * mono/uppercase program name, tabular count chip, a rule that stretches across
 * the row, and (for programs) a subtle link to the program page.
 */
export function TargetGroupHeader({ name, count, programId }: TargetGroupHeaderProps) {
  const isProgram = programId != null;

  return (
    <div className="flex items-center gap-2.5">
      {isProgram ? (
        <FolderKanban className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      )}
      <span
        className={cn(
          "truncate font-mono text-[11px] font-semibold uppercase tracking-[0.12em]",
          isProgram ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {name}
      </span>
      <span className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide tabular-nums text-muted-foreground">
        {count}
      </span>
      <div className="h-px flex-1 bg-border" aria-hidden="true" />
      {isProgram && (
        <Link
          to={`/program/${programId}`}
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-primary"
        >
          View
          <ArrowUpRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
