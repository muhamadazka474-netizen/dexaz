"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Database,
  LayoutDashboard,
  Plug,
  FolderTree,
  Terminal,
  BookOpen,
  GraduationCap,
  History,
  FileText,
  LogOut,
  Wand2,
  Network,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Palette,
  Check,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { THEMES } from "@/lib/themes";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { href: "/connections", label: "Connections", icon: Plug, enabled: true },
  { href: "/explorer", label: "Explorer", icon: FolderTree, enabled: true },
  { href: "/erd", label: "ERD Diagram", icon: Network, enabled: true },
  { href: "/sql-editor", label: "SQL Editor", icon: Terminal, enabled: true },
  { href: "/query-builder", label: "Query Builder", icon: Wand2, enabled: true },
  { href: "/library", label: "SQL Library", icon: BookOpen, enabled: true },
  { href: "/reference", label: "Referensi SQL", icon: GraduationCap, enabled: true },
  { href: "/history", label: "History", icon: History, enabled: true },
  { href: "/documents", label: "Dokumen", icon: FileText, enabled: true },
];

const SIDEBAR_COLLAPSED_KEY = "dbx:sidebar-collapsed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { username, logout } = useAuth();
  const { mode, toggleTheme, themeId, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // localStorage unavailable — just keep the default expanded state.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  return (
    // h-screen (not min-h-screen) + overflow-hidden bounds this container to
    // the viewport, so the sidebar and header below stay fixed in place and
    // only <main> scrolls internally — otherwise, on a long page, the whole
    // document (including the nav) scrolled away with the content.
    <div className="h-screen overflow-hidden flex bg-void text-text">
      <aside
        className={`${
          collapsed ? "w-16" : "w-60"
        } shrink-0 border-r border-border-glass dbx-glass flex flex-col transition-[width] duration-150 ease-in-out`}
      >
        <div
          className={`h-16 flex items-center gap-2.5 border-b border-border-glass ${
            collapsed ? "justify-center px-0" : "px-5"
          }`}
        >
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan to-blue flex items-center justify-center dbx-glow-cyan shrink-0">
            <Database size={16} className="text-void" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <span className="font-display text-[15px] tracking-tight truncate block">DEXAZ</span>
              <span className="text-[9px] text-text-faint tracking-tight truncate block leading-none">
                Database Explorer Azka
              </span>
            </div>
          )}
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto dbx-scrollbar">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            const content = (
              <>
                <Icon size={16} strokeWidth={2} className="shrink-0" />
                {!collapsed && (
                  <>
                    <span>{item.label}</span>
                    {!item.enabled && (
                      <span className="ml-auto text-[9px] uppercase tracking-wide text-text-faint border border-border-glass rounded px-1.5 py-0.5">
                        Phase&nbsp;2+
                      </span>
                    )}
                  </>
                )}
              </>
            );
            return item.enabled ? (
              <Link
                key={item.label}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors ${
                  collapsed ? "justify-center px-2" : "px-3"
                } ${
                  active
                    ? "bg-panel-2 text-text border border-border-glass-strong dbx-glow-cyan"
                    : "text-text-muted hover:text-text hover:bg-panel/60"
                }`}
              >
                {content}
              </Link>
            ) : (
              <div
                key={item.label}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-2.5 rounded-lg py-2 text-sm text-text-faint cursor-not-allowed select-none ${
                  collapsed ? "justify-center px-2" : "px-3"
                }`}
              >
                {content}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t border-border-glass space-y-2">
          {/* "Tema" — opens a flyout of every theme in the picker (see
              frontend/src/lib/themes.ts). Deliberately placed outside the
              scrollable <nav> above: nav has overflow-y-auto, and CSS
              forces overflow-x to auto right along with it, which was
              silently clipping this popover the moment it tried to
              extend past the sidebar's right edge. This footer area has
              no overflow set, so the popover renders in full. */}
          <div className="relative">
            <button
              onClick={() => setThemeMenuOpen((o) => !o)}
              title={collapsed ? "Tema" : undefined}
              className={`w-full flex items-center gap-2.5 rounded-lg py-2 text-sm transition-colors ${
                collapsed ? "justify-center px-2" : "px-3"
              } ${
                themeMenuOpen
                  ? "bg-panel-2 text-text border border-border-glass-strong dbx-glow-cyan"
                  : "text-text-muted hover:text-text hover:bg-panel/60"
              }`}
            >
              <Palette size={16} strokeWidth={2} className="shrink-0" />
              {!collapsed && <span>Tema</span>}
            </button>

            {themeMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setThemeMenuOpen(false)}
                />
                <div className="absolute left-full bottom-0 ml-2 z-40 dbx-glass-strong rounded-lg p-2 w-64 max-h-[70vh] overflow-y-auto overscroll-contain dbx-scrollbar">
                  <div className="px-1.5 pb-1.5 mb-1.5 border-b border-border-glass text-[11px] uppercase tracking-wide text-text-faint">
                    Pilih Tema Website
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {THEMES.map((t) => {
                      const active = themeId === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            setTheme(t.id);
                            setThemeMenuOpen(false);
                          }}
                          className={`flex flex-col items-start gap-1.5 rounded-lg p-1.5 border text-left transition-colors ${
                            active
                              ? "border-cyan/40 bg-cyan/10"
                              : "border-border-glass hover:border-border-glass-strong hover:bg-panel/60"
                          }`}
                        >
                          <span
                            className="h-6 w-full rounded-md flex items-center justify-end gap-1 px-1.5 border border-white/10"
                            style={{ background: t.swatchBg }}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ background: t.swatchAccent }}
                            />
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ background: t.swatchAccent2 }}
                            />
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-text w-full">
                            {active ? (
                              <Check size={11} className="text-cyan shrink-0" />
                            ) : (
                              <span className="w-[11px] shrink-0" />
                            )}
                            <span className="truncate">{t.name}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          <div
            className={`flex items-center gap-2 rounded-lg py-2 text-sm text-text-muted ${
              collapsed ? "justify-center px-0" : "px-3"
            }`}
          >
            <div className="h-6 w-6 rounded-full bg-panel-2 border border-border-glass flex items-center justify-center text-[11px] font-medium text-text shrink-0">
              {username?.[0]?.toUpperCase() ?? "?"}
            </div>
            {!collapsed && <span className="truncate">{username}</span>}
            <button
              onClick={logout}
              title="Keluar"
              className={`text-text-faint hover:text-danger transition-colors ${collapsed ? "" : "ml-auto"}`}
            >
              <LogOut size={15} />
            </button>
          </div>
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs text-text-faint hover:text-text hover:bg-panel/60 border border-border-glass transition-colors"
          >
            {collapsed ? (
              <ChevronRight size={14} />
            ) : (
              <>
                <ChevronLeft size={14} />
                <span>Ciutkan</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 shrink-0 border-b border-border-glass dbx-glass flex items-center justify-between px-6">
          <div className="flex items-center gap-2 text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-success dbx-status-live" />
            <span className="uppercase tracking-[0.18em] text-text-muted">Local Mode</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              title={mode === "dark" ? "Ganti ke Light Mode" : "Ganti ke Dark Mode"}
              className="flex items-center justify-center h-8 w-8 rounded-lg text-text-muted hover:text-text hover:bg-panel/60 border border-border-glass transition-colors"
            >
              {mode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <div className="text-xs text-text-faint font-mono">127.0.0.1</div>
          </div>
        </header>
        <main className="flex-1 min-w-0 overflow-auto dbx-scrollbar">{children}</main>
      </div>
    </div>
  );
}
