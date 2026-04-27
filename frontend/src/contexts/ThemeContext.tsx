import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_DARK, DEFAULT_THEME, THEMES, type ThemeId } from "@/lib/themes";

// Derived from THEMES so it stays in sync when themes are added/removed
const VALID_THEMES = THEMES.map((t) => t.id);

const STORAGE_THEME = "recon-theme";
const STORAGE_DARK = "recon-dark";

interface ThemeContextValue {
  theme: ThemeId;
  dark: boolean;
  setTheme: (id: ThemeId) => void;
  toggleDark: () => void;
  setDark: (dark: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const stored = localStorage.getItem(STORAGE_THEME) as ThemeId | null;
    return stored && VALID_THEMES.includes(stored) ? stored : DEFAULT_THEME;
  });
  const [dark, setDarkState] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_DARK);
    return stored === null ? DEFAULT_DARK : stored !== "false";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.classList.toggle("dark", dark);
    localStorage.setItem(STORAGE_THEME, theme);
    localStorage.setItem(STORAGE_DARK, String(dark));
  }, [theme, dark]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        dark,
        setTheme: setThemeState,
        toggleDark: () => setDarkState((d) => !d),
        setDark: setDarkState,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
