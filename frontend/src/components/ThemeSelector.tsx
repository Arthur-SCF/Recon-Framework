import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Palette, Sun, Moon, Check } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { THEMES, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";

export function ThemeSelector() {
  const { theme, dark, setTheme, setDark } = useTheme();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="Change theme"
          title="Change theme"
        >
          <Palette className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-64 rounded-[var(--radius)] border border-border bg-card p-2 shadow-xl"
        >
          {/* Theme list */}
          <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Theme
          </p>

          {THEMES.map((t) => (
            <DropdownMenu.Item
              key={t.id}
              onSelect={() => setTheme(t.id as ThemeId)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded px-2 py-2 text-sm outline-none transition-colors",
                theme === t.id
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-muted",
              )}
            >
              {/* Color swatch */}
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                style={{ background: t.swatch.bg, border: "1.5px solid var(--border)" }}
              >
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ background: t.swatch.primary, boxShadow: `0 0 5px ${t.swatch.primary}99` }}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="font-medium leading-none">{t.label}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {t.description}
                </div>
              </div>

              {theme === t.id && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </DropdownMenu.Item>
          ))}

          <DropdownMenu.Separator className="my-2 h-px bg-border" />

          {/* Light / Dark toggle */}
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Mode
          </p>
          <div className="flex gap-1.5 px-2 pb-1">
            <button
              onClick={() => setDark(false)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                !dark
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Sun className="h-3.5 w-3.5" />
              Light
            </button>
            <button
              onClick={() => setDark(true)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                dark
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Moon className="h-3.5 w-3.5" />
              Dark
            </button>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
