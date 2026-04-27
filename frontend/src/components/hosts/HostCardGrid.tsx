import type { LiveHost } from "@/types/api";
import { HostCard } from "./HostCard";

const PAGE_SIZE = 24;

interface HostCardGridProps {
  hosts: LiveHost[];
  targetId: string;
  page: number;
  onPageChange: (page: number) => void;
  onHostClick?: (host: LiveHost) => void;
}

export function HostCardGrid({
  hosts,
  targetId,
  page,
  onPageChange,
  onHostClick,
}: HostCardGridProps) {
  const totalPages = Math.ceil(hosts.length / PAGE_SIZE);
  const paged = hosts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {paged.map((host, i) => (
          <HostCard
            key={host.id}
            host={host}
            targetId={targetId}
            index={i}
            onClick={onHostClick ? () => onHostClick(host) : undefined}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Page {page + 1} of {totalPages} ({hosts.length} hosts)</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(Math.max(0, page - 1))}
              disabled={page === 0}
              className="rounded border border-border bg-background px-2 py-1 disabled:opacity-40 hover:text-foreground transition-colors"
            >
              Prev
            </button>
            <input
              type="number"
              min={1}
              max={totalPages}
              placeholder={String(page + 1)}
              className="w-12 rounded border border-border bg-background px-1.5 py-1 text-center text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (!isNaN(v)) onPageChange(Math.min(totalPages - 1, Math.max(0, v - 1)));
                (e.target as HTMLInputElement).value = "";
              }}
            />
            <button
              onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="rounded border border-border bg-background px-2 py-1 disabled:opacity-40 hover:text-foreground transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
