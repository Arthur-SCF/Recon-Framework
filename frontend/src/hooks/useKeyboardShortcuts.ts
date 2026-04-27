import { useEffect } from "react";

export interface ShortcutConfig {
  /** Called when `/` is pressed — should focus the global search input */
  onFocusSearch?: () => void;
  /** Called when `n` is pressed — should open the new-target dialog */
  onNewTarget?: () => void;
  /** Called when `?` is pressed — should open the shortcuts help modal */
  onShowHelp?: () => void;
  /** Called when `s` is pressed — start scan on current target (page-specific) */
  onStartScan?: () => void;
  /** Called when `p` is pressed — pause/resume scan on current target */
  onTogglePause?: () => void;
  /**
   * Called when a digit key 1–8 is pressed — switch to the corresponding tab
   * (page-specific; pass null when no tab target is active).
   */
  onSwitchTab?: (index: number) => void;
}

/**
 * Registers a global `keydown` listener that fires the appropriate callback
 * for each shortcut. Shortcuts are silenced whenever the user is typing in an
 * `<input>`, `<textarea>`, or `[contenteditable]` element, and when any
 * modifier key (Ctrl / Cmd / Alt) is held.
 */
export function useKeyboardShortcuts(config: ShortcutConfig) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when modifiers are held (browser shortcuts, form submission, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Ignore when typing in an input-like element
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      ) {
        // Exception: Escape should still work to blur / close modals
        if (e.key === "Escape") {
          (target as HTMLInputElement).blur?.();
        }
        return;
      }

      switch (e.key) {
        case "/":
          e.preventDefault();
          config.onFocusSearch?.();
          break;

        case "n":
        case "N":
          config.onNewTarget?.();
          break;

        case "?":
          config.onShowHelp?.();
          break;

        case "s":
        case "S":
          config.onStartScan?.();
          break;

        case "p":
        case "P":
          config.onTogglePause?.();
          break;

        default:
          if (e.key >= "1" && e.key <= "8") {
            config.onSwitchTab?.(parseInt(e.key, 10) - 1);
          }
          break;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config.onFocusSearch,
    config.onNewTarget,
    config.onShowHelp,
    config.onStartScan,
    config.onTogglePause,
    config.onSwitchTab,
  ]);
}
