import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Search, Server, Globe, Layers, Shield, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchTarget {
  id: string;
  domain: string;
  status: string;
}

interface SearchSubdomain {
  id: string;
  subdomain: string;
  is_live: boolean;
  target_id: string;
  target_domain: string;
}

interface SearchHost {
  id: string;
  url: string;
  status_code: number | null;
  title: string | null;
  target_id: string;
  target_domain: string;
}

interface SearchPort {
  id: string;
  host: string;
  port: number;
  service: string | null;
  target_id: string;
  target_domain: string;
}

interface SearchTakeover {
  id: string;
  subdomain: string;
  service: string | null;
  severity: string | null;
  target_id: string;
  target_domain: string;
}

interface SearchResults {
  targets?: SearchTarget[];
  targets_has_more?: boolean;
  subdomains?: SearchSubdomain[];
  subdomains_has_more?: boolean;
  hosts?: SearchHost[];
  hosts_has_more?: boolean;
  ports?: SearchPort[];
  ports_has_more?: boolean;
  takeovers?: SearchTakeover[];
  takeovers_has_more?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(code: number | null): string {
  if (!code) return "text-muted-foreground";
  if (code < 300) return "text-sev-low";
  if (code < 400) return "text-sev-info";
  if (code < 500) return "text-sev-medium";
  return "text-sev-critical";
}

function sevColor(sev: string | null): string {
  if (sev === "critical") return "text-sev-critical";
  if (sev === "high") return "text-sev-high";
  if (sev === "medium") return "text-sev-medium";
  if (sev === "low") return "text-sev-info";
  return "text-muted-foreground";
}

function hasResults(r: SearchResults): boolean {
  return (
    (r.targets?.length ?? 0) > 0 ||
    (r.subdomains?.length ?? 0) > 0 ||
    (r.hosts?.length ?? 0) > 0 ||
    (r.ports?.length ?? 0) > 0 ||
    (r.takeovers?.length ?? 0) > 0
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GlobalSearchHandle {
  focus(): void;
}

export const GlobalSearch = forwardRef<GlobalSearchHandle>((_, ref) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useImperativeHandle(ref, () => ({
    focus() {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }));

  const search = useCallback(async (q: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    try {
      const url = `/api/v1/search?q=${encodeURIComponent(q)}&type=all`;
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SearchResults;
      // Sort subdomains: live first, then alphabetical
      if (data.subdomains) {
        data.subdomains = [...data.subdomains].sort(
          (a, b) => (b.is_live ? 1 : 0) - (a.is_live ? 1 : 0) || a.subdomain.localeCompare(b.subdomain)
        );
      }
      setResults(data);
      setOpen(true);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setResults(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults(null);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => void search(query.trim()), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleNavigate(path: string) {
    setOpen(false);
    setQuery("");
    navigate(path);
  }

  const showDropdown = open && query.trim().length > 0;
  const empty = results !== null && !hasResults(results);
  const q = encodeURIComponent(query.trim());

  return (
    <div className="relative">
      <div className="relative flex items-center">
        {loading ? (
          <Loader2 className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-muted-foreground" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results && hasResults(results)) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); } }}
          placeholder="Search…"
          className="h-8 w-32 rounded-md border border-border bg-background pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground transition-[width,border-color] duration-200 focus:w-52 focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary sm:w-56 sm:focus:w-72"
        />
        {!query && (
          <kbd className="pointer-events-none absolute right-2 hidden select-none items-center rounded border border-border bg-muted px-1.5 py-px font-mono text-[10px] font-medium leading-tight text-faint-foreground sm:inline-flex">
            /
          </kbd>
        )}
      </div>

      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute right-0 top-full mt-1.5 w-[calc(100vw-1.5rem)] sm:w-80 max-w-[20rem] rounded-lg border border-border bg-card shadow-xl z-50 max-h-96 overflow-y-auto"
        >
          {empty ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : (
            <div className="py-1">
              {/* Targets */}
              {(results?.targets ?? []).length > 0 && (
                <ResultSection label="Targets" icon={<Globe className="h-3 w-3" />}>
                  {(results!.targets!).map((t) => (
                    <ResultRow
                      key={t.id}
                      primary={t.domain}
                      secondary={t.status}
                      onClick={() => handleNavigate(`/target/${t.id}`)}
                    />
                  ))}
                  {results?.targets_has_more && (
                    <ViewAllButton onClick={() => handleNavigate(`/?q=${q}`)}>
                      View all targets →
                    </ViewAllButton>
                  )}
                </ResultSection>
              )}

              {/* Hosts */}
              {(results?.hosts ?? []).length > 0 && (
                <ResultSection label="Live Hosts" icon={<Server className="h-3 w-3" />}>
                  {(results!.hosts!).map((h) => (
                    <ResultRow
                      key={h.id}
                      primary={h.url.replace(/^https?:\/\//, "")}
                      secondary={h.title ?? h.target_domain}
                      badge={h.status_code ? String(h.status_code) : undefined}
                      badgeClass={statusColor(h.status_code)}
                      onClick={() => handleNavigate(`/target/${h.target_id}?tab=hosts`)}
                    />
                  ))}
                  {results?.hosts_has_more && results.hosts![0] && (
                    <ViewAllButton onClick={() => handleNavigate(`/target/${results.hosts![0].target_id}?tab=hosts&q=${q}`)}>
                      View all hosts →
                    </ViewAllButton>
                  )}
                </ResultSection>
              )}

              {/* Subdomains */}
              {(results?.subdomains ?? []).length > 0 && (
                <ResultSection label="Subdomains" icon={<Layers className="h-3 w-3" />}>
                  {(results!.subdomains!).map((s) => (
                    <ResultRow
                      key={s.id}
                      primary={s.subdomain}
                      secondary={s.target_domain}
                      badge={s.is_live ? "live" : undefined}
                      onClick={() => handleNavigate(`/target/${s.target_id}?tab=subdomains`)}
                    />
                  ))}
                  {results?.subdomains_has_more && results.subdomains![0] && (
                    <ViewAllButton onClick={() => handleNavigate(`/target/${results.subdomains![0].target_id}?tab=subdomains&q=${q}`)}>
                      View all subdomains →
                    </ViewAllButton>
                  )}
                </ResultSection>
              )}

              {/* Ports */}
              {(results?.ports ?? []).length > 0 && (
                <ResultSection label="Ports" icon={<Wifi className="h-3 w-3" />}>
                  {(results!.ports!).map((p) => (
                    <ResultRow
                      key={p.id}
                      primary={`${p.host}:${p.port}`}
                      secondary={p.service ?? p.target_domain}
                      onClick={() => handleNavigate(`/target/${p.target_id}?tab=ports`)}
                    />
                  ))}
                  {results?.ports_has_more && results.ports![0] && (
                    <ViewAllButton onClick={() => handleNavigate(`/target/${results.ports![0].target_id}?tab=ports&q=${q}`)}>
                      View all ports →
                    </ViewAllButton>
                  )}
                </ResultSection>
              )}

              {/* Takeovers */}
              {(results?.takeovers ?? []).length > 0 && (
                <ResultSection label="Takeovers" icon={<Shield className="h-3 w-3" />}>
                  {(results!.takeovers!).map((t) => (
                    <ResultRow
                      key={t.id}
                      primary={t.subdomain}
                      secondary={t.service ?? t.target_domain}
                      badge={t.severity ?? undefined}
                      badgeClass={sevColor(t.severity)}
                      onClick={() => handleNavigate(`/target/${t.target_id}?tab=takeovers`)}
                    />
                  ))}
                  {results?.takeovers_has_more && results.takeovers![0] && (
                    <ViewAllButton onClick={() => handleNavigate(`/target/${results.takeovers![0].target_id}?tab=takeovers&q=${q}`)}>
                      View all takeovers →
                    </ViewAllButton>
                  )}
                </ResultSection>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

GlobalSearch.displayName = "GlobalSearch";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ResultSection({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function ResultRow({
  primary,
  secondary,
  badge,
  badgeClass,
  onClick,
}: {
  primary: string;
  secondary?: string | null;
  badge?: string;
  badgeClass?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-3 py-2 text-left",
        "hover:bg-surface-hover transition-colors",
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="truncate font-mono text-xs text-foreground">{primary}</p>
        {secondary && (
          <p className="truncate text-[10px] text-muted-foreground">{secondary}</p>
        )}
      </div>
      {badge && (
        <span className={cn("shrink-0 font-mono text-[10px]", badgeClass ?? "text-muted-foreground")}>
          {badge}
        </span>
      )}
    </button>
  );
}

function ViewAllButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="block w-full text-left px-3 py-1.5 text-xs text-primary hover:bg-surface-hover transition-colors"
    >
      {children}
    </button>
  );
}
