"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { DEFAULT_THEME_ID, getThemeById, THEMES, ThemeMode } from "./themes";

const THEME_KEY = "dbx:theme";
const THEME_MODE_KEY = "dbx:theme-mode";

interface ThemeContextValue {
  /** Currently active theme id, e.g. "dark", "emerald-terminal", "rose-quartz". */
  themeId: string;
  /** "dark" or "light" — derived from the active theme, used for quick toggling and the sun/moon icon. */
  mode: ThemeMode;
  /** Switch to a specific theme by id. */
  setTheme: (id: string) => void;
  /** Quick-toggle between the plain "dark" and "light" base themes. */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME_ID,
  mode: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
});

function applyThemeToDom(id: string) {
  const def = getThemeById(id);
  document.documentElement.dataset.theme = def.id;
  document.documentElement.style.colorScheme = def.mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The inline script in layout.tsx already applies the saved/OS theme to
  // <html> before hydration (avoids a flash of the wrong theme). Here we
  // just read it back so React state matches what's already on screen.
  const [themeId, setThemeIdState] = useState<string>(DEFAULT_THEME_ID);

  useEffect(() => {
    try {
      const current = document.documentElement.dataset.theme;
      if (current && THEMES.some((t) => t.id === current)) {
        setThemeIdState(current);
        return;
      }
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved && THEMES.some((t) => t.id === saved)) {
        setThemeIdState(saved);
        applyThemeToDom(saved);
      }
    } catch {
      // localStorage unavailable — keep default theme.
    }
  }, []);

  function setTheme(id: string) {
    const def = getThemeById(id);
    setThemeIdState(def.id);
    applyThemeToDom(def.id);
    try {
      window.localStorage.setItem(THEME_KEY, def.id);
      window.localStorage.setItem(THEME_MODE_KEY, def.mode);
    } catch {
      // ignore
    }
  }

  function toggleTheme() {
    const currentMode = getThemeById(themeId).mode;
    setTheme(currentMode === "dark" ? "light" : "dark");
  }

  const mode = getThemeById(themeId).mode;

  return (
    <ThemeContext.Provider value={{ themeId, mode, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
