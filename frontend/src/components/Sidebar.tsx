import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  FolderKanban,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

function ApertureMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" opacity="0.85" />
      <path
        d="M12 1.75V5.5M12 18.5v3.75M1.75 12H5.5M18.5 12h3.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" />
    </svg>
  );
}
import { SidebarScanStatus } from "./sidebar/SidebarScanStatus";
import { SidebarQuickStats } from "./sidebar/SidebarQuickStats";
import { SidebarRecentTargets } from "./sidebar/SidebarRecentTargets";

const STORAGE_KEY = "sidebar-collapsed";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/programs", label: "Programs", icon: FolderKanban },
  { to: "/settings", label: "Settings", icon: Settings },
];

interface SidebarProps {
  /** Mobile: whether the sidebar is open (slide-over). Ignored on lg+. */
  open?: boolean;
  /** Mobile: called when the sidebar should close. */
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [healthy, setHealthy] = useState(true);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const check = () => {
      void fetch("/api/v1/health")
        .then((r) => setHealthy(r.ok))
        .catch(() => setHealthy(false));
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside
      className={cn(
        // Mobile: fixed slide-over; Desktop: normal flow
        "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-sidebar transition-all duration-200",
        "lg:relative lg:z-auto lg:inset-auto lg:h-full",
        // Mobile open/close via translate
        open ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Logo / operator wordmark */}
      <div
        className={cn(
          "relative flex h-14 items-center gap-2.5 overflow-hidden border-b border-border",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        <div className="deck-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
        <span className="pointer-events-none absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-primary/50 via-primary/10 to-transparent" aria-hidden="true" />
        <span className="group/mark relative flex h-6 w-6 shrink-0 items-center justify-center text-primary">
          <ApertureMark className="h-6 w-6 transition-[filter] duration-200 group-hover/mark:drop-shadow-[0_0_6px_var(--primary)]" />
        </span>
        {!collapsed && (
          <div className="relative flex min-w-0 items-center gap-2">
            <span className="font-mono text-[13px] font-semibold tracking-[0.18em] text-sidebar-foreground">
              RECON<span className="text-faint-foreground">_APP</span>
            </span>
            <span
              className={cn(
                "led h-1.5 w-1.5 rounded-full",
                healthy ? "text-sev-low" : "text-sev-critical",
              )}
              style={{ backgroundColor: "currentColor" }}
              title={healthy ? "Armed — backend online" : "Backend unreachable"}
            />
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="px-2 py-3">
        {!collapsed && (
          <p className="flex items-center gap-1.5 px-2 pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-faint-foreground">
            <span className="h-2 w-0.5 rounded-full bg-primary/60" aria-hidden="true" />
            Navigation
          </p>
        )}
        <div className="space-y-0.5">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "group/nav relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-all",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-accent text-foreground font-medium ring-1 ring-inset ring-primary/15"
                    : "text-muted-foreground hover:bg-surface-hover hover:text-sidebar-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  {!collapsed && (
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full bg-primary transition-all",
                        isActive
                          ? "deck-rail-glow h-5 w-[3px] opacity-100"
                          : "h-4 w-0.5 opacity-0 group-hover/nav:opacity-40",
                      )}
                    />
                  )}
                  <Icon className={cn("h-4 w-4 shrink-0 transition-colors", isActive && "text-primary")} />
                  {!collapsed && <span>{label}</span>}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Divider */}
      <div className="mx-3 border-t border-border" />

      {/* Active Scan Status */}
      <SidebarScanStatus collapsed={collapsed} />

      {/* Divider */}
      <div className="mx-3 border-t border-border" />

      {/* Quick Stats */}
      <SidebarQuickStats collapsed={collapsed} />

      {/* Recent Targets */}
      <SidebarRecentTargets collapsed={collapsed} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Footer: health + collapse toggle */}
      <div className="border-t border-border px-3 py-2">
        <div className={cn("flex items-center", collapsed ? "justify-center" : "justify-between")}>
          {/* Health LED */}
          <div
            className="flex items-center gap-2"
            title={healthy ? "Backend healthy" : "Backend unreachable"}
          >
            <span
              className={cn(
                "led h-2 w-2 rounded-full shrink-0",
                healthy ? "text-sev-low" : "text-sev-critical",
              )}
              style={{ backgroundColor: "currentColor" }}
            />
            {!collapsed && (
              <span
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.14em]",
                  healthy ? "text-muted-foreground" : "text-sev-critical",
                )}
              >
                {healthy ? "Online" : "Offline"}
              </span>
            )}
          </div>

          {/* Collapse toggle */}
          {!collapsed && (
            <button
              onClick={toggle}
              className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        {collapsed && (
          <button
            onClick={toggle}
            className="mt-1 flex w-full justify-center rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
