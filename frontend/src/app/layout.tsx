import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme-context";

export const metadata: Metadata = {
  title: "DEXAZ — Database Explorer Azka",
  description: "Local-first database management & SQL analytics platform.",
};

// Runs before React hydrates so the correct theme is applied on first
// paint — without this there'd be a flash of the wrong theme before
// switching to a saved preference. Kept in sync with the theme id list in
// frontend/src/lib/themes.ts (duplicated here since this inline script
// can't import a module) and the mode is cached separately in
// 'dbx:theme-mode' so this script never needs the full registry just to
// know whether a custom theme id is dark or light.
const THEME_BOOTSTRAP_SCRIPT = `
try {
  var KNOWN = ['dark','light','midnight-violet','emerald-terminal','solar-amber','crimson-noir','ocean-deep','nord-frost','cyber-pink','rose-quartz','sandstone','mint-fresh','slate-pro'];
  var t = localStorage.getItem('dbx:theme');
  var m = localStorage.getItem('dbx:theme-mode');
  if (!t || KNOWN.indexOf(t) === -1) {
    var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    t = prefersLight ? 'light' : 'dark';
    m = t;
  }
  if (m !== 'light' && m !== 'dark') { m = 'dark'; }
  document.documentElement.dataset.theme = t;
  document.documentElement.style.colorScheme = m;
} catch (e) {}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the inline script below intentionally sets
    // data-theme / style.colorScheme on this element before React hydrates
    // (to avoid a flash of the wrong theme), so the server-rendered HTML
    // and the pre-hydration DOM will legitimately differ here. Without this
    // flag React logs a hydration mismatch even though nothing is actually
    // broken. Scoped to just this tag — it does not suppress mismatches
    // anywhere else in the tree.
    <html lang="id" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="font-body antialiased">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
