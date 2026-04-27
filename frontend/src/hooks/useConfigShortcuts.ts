/**
 * useConfigShortcuts — keyboard shortcuts for the pipeline config tab.
 *
 * Shortcuts (only active when no input/textarea is focused):
 *   j / ArrowDown  → focus next step row
 *   k / ArrowUp    → focus prev step row
 *   Space          → toggle the focused step's enable switch
 *   e              → expand all groups
 *   c              → collapse all groups
 *   Escape         → collapse all groups (if expanded) or blur focus
 *
 * The hook is intentionally simple — no global state mutation.
 * It receives callbacks from the parent and calls them on matching keydown.
 */
import { useEffect, useCallback, useRef } from "react";

interface Options {
  /** Called when user presses e → expand all */
  onExpandAll:   () => void;
  /** Called when user presses c or Esc → collapse all */
  onCollapseAll: () => void;
  /** Whether the config tab is currently active / mounted */
  enabled?: boolean;
}

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = (el as HTMLElement).tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useConfigShortcuts({ onExpandAll, onCollapseAll, enabled = true }: Options) {
  // Stable ref to the focusable step-row elements on the page
  const stableCallbacks = useRef({ onExpandAll, onCollapseAll });
  useEffect(() => {
    stableCallbacks.current = { onExpandAll, onCollapseAll };
  });

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled) return;
    // Don't intercept when typing in an input
    if (isEditableTarget(document.activeElement)) return;

    const { key } = e;

    // Collect focusable step rows (buttons with role="switch" inside .step-row,
    // or any element with data-step-row attribute)
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-step-row]")
    );
    const focused = document.activeElement as HTMLElement | null;
    const idx = focused ? rows.indexOf(focused) : -1;

    switch (key) {
      case "j":
      case "ArrowDown": {
        e.preventDefault();
        const next = rows[idx + 1] ?? rows[0];
        next?.focus();
        break;
      }
      case "k":
      case "ArrowUp": {
        e.preventDefault();
        const prev = rows[idx - 1] ?? rows[rows.length - 1];
        prev?.focus();
        break;
      }
      case " ": {
        if (idx >= 0) {
          e.preventDefault();
          // Find the Switch inside the focused row and click it
          const sw = rows[idx].querySelector<HTMLElement>('[role="switch"]');
          sw?.click();
        }
        break;
      }
      case "e": {
        e.preventDefault();
        stableCallbacks.current.onExpandAll();
        break;
      }
      case "c":
      case "Escape": {
        e.preventDefault();
        stableCallbacks.current.onCollapseAll();
        break;
      }
      default:
        break;
    }
  }, [enabled]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
