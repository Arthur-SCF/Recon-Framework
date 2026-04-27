import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { Target } from "@/types/api";

interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs() {
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const [targetDomain, setTargetDomain] = useState<string | null>(null);

  // Fetch target domain if on a target detail page
  useEffect(() => {
    if (!id) {
      setTargetDomain(null);
      return;
    }
    void fetch(`/api/v1/targets/${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<Target>) : null))
      .then((t) => setTargetDomain(t?.domain ?? null))
      .catch(() => setTargetDomain(null));
  }, [id]);

  const crumbs: Crumb[] = [{ label: "Dashboard", to: "/" }];

  const path = location.pathname;

  if (path.includes("/pipeline/edit") && id) {
    crumbs.push({ label: targetDomain ?? id, to: `/target/${id}` });
    crumbs.push({ label: "Pipeline Config" });
  } else if (path.startsWith("/target/") && id) {
    crumbs.push({ label: targetDomain ?? id });
  } else if (path === "/settings") {
    crumbs.push({ label: "Settings" });
  }

  // Don't render if only the root crumb
  if (crumbs.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            {crumb.to && !isLast ? (
              <Link
                to={crumb.to}
                className="hover:text-primary transition-colors"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className={isLast ? "text-foreground font-medium" : ""}>
                {crumb.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
