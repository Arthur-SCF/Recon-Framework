import { useCallback, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarScanStatus } from "./sidebar/SidebarScanStatus";
import { SidebarQuickStats } from "./sidebar/SidebarQuickStats";
import { SidebarRecentTargets } from "./sidebar/SidebarRecentTargets";

const STORAGE_KEY = "sidebar-collapsed";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
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
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Zap className="h-5 w-5 text-primary shrink-0 hover:drop-shadow-[0_0_6px_var(--primary)] transition-all" />
        {!collapsed && (
          <span className="font-semibold tracking-tight text-sidebar-foreground">
            RECON_APP
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="px-2 py-3 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={collapsed ? label : undefined}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-[var(--radius)] px-3 py-2 text-sm transition-colors",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-sidebar-foreground",
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && label}
          </NavLink>
        ))}
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
          {/* Health dot */}
          <div
            className="flex items-center gap-1.5"
            title={healthy ? "Backend healthy" : "Backend unreachable"}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                healthy ? "bg-green-400" : "bg-red-400",
              )}
            />
            {!collapsed && (
              <span className="text-[10px] text-muted-foreground">
                {healthy ? "Healthy" : "Offline"}
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
