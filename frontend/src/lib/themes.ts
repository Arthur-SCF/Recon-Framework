export interface ThemeConfig {
  id: ThemeId;
  label: string;
  description: string;
  /** Swatch colors shown in the picker — always the dark variant */
  swatch: { bg: string; primary: string; accent: string };
}

export type ThemeId = "neon-recon" | "eslinks" | "resolve-ai" | "claude";

export const THEMES: ThemeConfig[] = [
  {
    id: "neon-recon",
    label: "Neon Recon",
    description: "Electric cyan on a command-deck substrate",
    swatch: { bg: "#070b11", primary: "#34bdf2", accent: "#34d399" },
  },
  {
    id: "eslinks",
    label: "ESLinks",
    description: "Vivid blue & teal startup dashboard",
    swatch: { bg: "#11161f", primary: "#409cff", accent: "#00c47f" },
  },
  {
    id: "resolve-ai",
    label: "ResolveAI",
    description: "Professional navy & gold — minimal & clean",
    swatch: { bg: "#1c2433", primary: "#a68446", accent: "#2a3656" },
  },
  {
    id: "claude",
    label: "Claude",
    description: "Warm terracotta & cream — editorial feel",
    swatch: { bg: "#3d2f28", primary: "#c97a5a", accent: "#8a6a52" },
  },
];

export const DEFAULT_THEME: ThemeId = "neon-recon";
export const DEFAULT_DARK = true;
