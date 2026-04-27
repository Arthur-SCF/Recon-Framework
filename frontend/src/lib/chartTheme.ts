import { useMemo } from "react";
import { useTheme } from "@/contexts/ThemeContext";

/** Resolved CSS color values for recharts (which can't consume var() strings). */
export function useChartColors() {
  const { theme, dark } = useTheme();
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const resolve = (name: string) => {
      const raw = style.getPropertyValue(name).trim();
      // If value looks like an oklch/hsl/rgb function already, return as-is
      if (raw.startsWith("oklch") || raw.startsWith("hsl") || raw.startsWith("rgb") || raw.startsWith("#")) {
        return raw;
      }
      // Otherwise it's likely bare channel values — wrap in oklch()
      return `oklch(${raw})`;
    };

    return {
      primary: resolve("--primary"),
      foreground: resolve("--foreground"),
      muted: resolve("--muted-foreground"),
      card: resolve("--card"),
      border: resolve("--border"),
    };
  }, [theme, dark]); // re-compute when theme or dark mode changes
}

/** Fixed semantic colors for HTTP status codes. */
export const STATUS_COLORS: Record<string, string> = {
  "2xx": "#34d399",
  "3xx": "#60a5fa",
  "4xx": "#fbbf24",
  "5xx": "#f87171",
  other: "#94a3b8",
};

/** Fixed palette for top-N tech items. */
export const TECH_PALETTE = [
  "#34d399",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#fbbf24",
  "#fb923c",
  "#38bdf8",
  "#4ade80",
  "#c084fc",
  "#f87171",
];
