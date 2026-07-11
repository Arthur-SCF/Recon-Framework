import { LayoutGrid, List, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExportMenu } from "@/components/ExportMenu";

type SchemeFilter = "all" | "https" | "http";
type ViewMode = "table" | "grid";

interface HostFiltersProps {
  filter: string;
  onFilterChange: (value: string) => void;
  schemeFilter: SchemeFilter;
  onSchemeChange: (scheme: SchemeFilter) => void;
  statusFilter?: string | null;
  onStatusFilterClear?: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  filteredCount: number;
  totalCount: number;
  targetId: string;
}

const SCHEMES: SchemeFilter[] = ["all", "https", "http"];

export function HostFilters({
  filter,
  onFilterChange,
  schemeFilter,
  onSchemeChange,
  statusFilter,
  onStatusFilterClear,
  viewMode,
  onViewModeChange,
  filteredCount,
  totalCount,
  targetId,
}: HostFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        placeholder="Filter by URL, title, webserver, tech..."
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />

      {statusFilter && onStatusFilterClear && (
        <button
          onClick={onStatusFilterClear}
          className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 font-mono text-xs uppercase tracking-wide text-primary hover:bg-primary/20 transition-colors"
          title="Clear status filter"
        >
          {statusFilter}
          <X className="h-3 w-3" />
        </button>
      )}

      <div className="flex rounded-md border border-border overflow-hidden text-xs">
        {SCHEMES.map((s) => (
          <button
            key={s}
            onClick={() => onSchemeChange(s)}
            className={cn(
              "px-2.5 py-1.5 capitalize transition-colors",
              schemeFilter === s
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex rounded-md border border-border overflow-hidden">
        <button
          onClick={() => onViewModeChange("table")}
          title="Table view"
          className={cn(
            "p-1.5 transition-colors",
            viewMode === "table"
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onViewModeChange("grid")}
          title="Card view"
          className={cn(
            "p-1.5 transition-colors",
            viewMode === "grid"
              ? "bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
      </div>

      <ExportMenu targetId={targetId} type="hosts" />
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {filteredCount} / {totalCount}
      </span>
    </div>
  );
}
