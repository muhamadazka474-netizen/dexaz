// Central registry of every theme the app ships with. Each entry's `id`
// must have a matching `:root[data-theme="<id>"]` block in globals.css that
// defines the actual --dbx-* CSS variables — this file only carries the
// metadata needed to render the picker (name, light/dark mode, and small
// preview swatches), it is not the source of truth for colors.
export type ThemeMode = "dark" | "light";

export interface ThemeDefinition {
  id: string;
  name: string;
  mode: ThemeMode;
  /** Background swatch shown in the picker (matches --dbx-void). */
  swatchBg: string;
  /** Accent swatches shown in the picker (match --dbx-cyan / --dbx-violet). */
  swatchAccent: string;
  swatchAccent2: string;
}

export const THEMES: ThemeDefinition[] = [
  // ---- Dark themes ----
  { id: "dark", name: "Dark Future", mode: "dark", swatchBg: "#05070d", swatchAccent: "#2dd4f0", swatchAccent2: "#9b6bff" },
  { id: "midnight-violet", name: "Midnight Violet", mode: "dark", swatchBg: "#0b0a17", swatchAccent: "#a78bfa", swatchAccent2: "#f472b6" },
  { id: "emerald-terminal", name: "Emerald Terminal", mode: "dark", swatchBg: "#050807", swatchAccent: "#34e0a1", swatchAccent2: "#a3e635" },
  { id: "solar-amber", name: "Solar Amber", mode: "dark", swatchBg: "#0d0a06", swatchAccent: "#f5a524", swatchAccent2: "#fb7185" },
  { id: "crimson-noir", name: "Crimson Noir", mode: "dark", swatchBg: "#0a0607", swatchAccent: "#f0384a", swatchAccent2: "#fb923c" },
  { id: "ocean-deep", name: "Ocean Deep", mode: "dark", swatchBg: "#040c14", swatchAccent: "#22d3ee", swatchAccent2: "#38bdf8" },
  { id: "nord-frost", name: "Nord Frost", mode: "dark", swatchBg: "#0f1620", swatchAccent: "#88c0d0", swatchAccent2: "#8fbcbb" },
  { id: "cyber-pink", name: "Cyber Pink", mode: "dark", swatchBg: "#0a0510", swatchAccent: "#ff5ec4", swatchAccent2: "#7ef9ff" },

  // ---- Light themes ----
  { id: "light", name: "Terang", mode: "light", swatchBg: "#eef1f8", swatchAccent: "#0a8aa3", swatchAccent2: "#7c3aed" },
  { id: "rose-quartz", name: "Rose Quartz", mode: "light", swatchBg: "#fdf2f6", swatchAccent: "#e0507a", swatchAccent2: "#a855f7" },
  { id: "sandstone", name: "Sandstone", mode: "light", swatchBg: "#faf5ec", swatchAccent: "#c2691d", swatchAccent2: "#b45309" },
  { id: "mint-fresh", name: "Mint Fresh", mode: "light", swatchBg: "#f2faf6", swatchAccent: "#0f9d6a", swatchAccent2: "#0ea5b7" },
  { id: "slate-pro", name: "Slate Pro", mode: "light", swatchBg: "#f4f6f9", swatchAccent: "#3457d5", swatchAccent2: "#475569" },
];

export const DEFAULT_THEME_ID = "dark";

export function getThemeById(id: string | null | undefined): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}
