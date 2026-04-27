import { Check, Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { THEMES, type ThemeId } from "@/lib/themes";

export function AppearanceTab() {
  const { theme, dark, setTheme, setDark } = useTheme();

  return (
    <div className="py-6 space-y-8 max-w-2xl">
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-1">Color mode</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Choose between light and dark mode for all themes.
        </p>
        <div className="flex gap-3">
          {[
            { value: false, label: "Light", icon: Sun },
            { value: true,  label: "Dark",  icon: Moon },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={label}
              onClick={() => setDark(value)}
              className={cn(
                "flex flex-1 max-w-35 flex-col items-center gap-2 rounded-(--radius) border-2 p-4 transition-colors",
                dark === value
                  ? "border-primary bg-accent text-accent-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:bg-muted",
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-sm font-medium">{label}</span>
              {dark === value && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-1">Theme</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Pick a color theme. The preview shows the dark variant.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id as ThemeId)}
              className={cn(
                "group relative flex flex-col overflow-hidden rounded-(--radius) border-2 text-left transition-all",
                theme === t.id
                  ? "border-primary ring-2 ring-primary/20"
                  : "border-border hover:border-primary/50",
              )}
            >
              <div
                className="flex h-20 gap-1.5 p-2"
                style={{ background: t.swatch.bg }}
              >
                <div
                  className="flex w-5 flex-col gap-1 rounded-sm p-0.5"
                  style={{
                    background: `color-mix(in srgb, ${t.swatch.bg} 70%, #000)`,
                  }}
                >
                  <div className="h-1.5 w-full rounded-sm" style={{ background: t.swatch.primary }} />
                  <div className="h-1 w-3/4 rounded-sm" style={{ background: `${t.swatch.primary}60` }} />
                  <div className="h-1 w-3/4 rounded-sm" style={{ background: `${t.swatch.primary}40` }} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-2 w-3/4 rounded-sm" style={{ background: `${t.swatch.primary}cc` }} />
                  <div className="h-1.5 w-full rounded-sm" style={{ background: `${t.swatch.accent}80` }} />
                  <div className="h-1.5 w-2/3 rounded-sm" style={{ background: `${t.swatch.accent}50` }} />
                  <div className="mt-auto flex gap-1">
                    <div className="h-3 w-8 rounded-sm" style={{ background: t.swatch.primary }} />
                    <div className="h-3 w-6 rounded-sm" style={{ background: t.swatch.accent }} />
                  </div>
                </div>
              </div>
              <div className="bg-card px-2.5 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">{t.label}</span>
                  {theme === t.id && <Check className="h-3 w-3 text-primary" />}
                </div>
                <span className="text-[10px] text-muted-foreground leading-tight">
                  {t.description}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
