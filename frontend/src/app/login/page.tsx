"use client";

import { useState } from "react";
import { Database, Lock, User, ArrowRight, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Tidak dapat terhubung ke backend.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center overflow-hidden px-4">
      {/* ambient circuit-grid backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,178,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(148,178,255,0.6) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }}
      />
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-80 w-[42rem] rounded-full bg-blue/20 blur-[110px]" />

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center gap-1.5 mb-8">
          <div className="flex items-center gap-2.5 justify-center">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-cyan to-blue flex items-center justify-center dbx-glow-cyan">
              <Database size={18} className="text-void" strokeWidth={2.5} />
            </div>
            <span className="font-display text-lg tracking-tight text-text">DEXAZ</span>
          </div>
          <span className="text-[11px] text-text-faint tracking-tight">Database Explorer Azka</span>
        </div>

        <div className="dbx-glass-strong rounded-2xl p-7">
          <div className="mb-6">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-cyan mb-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success dbx-status-live" />
              Local Mode
            </div>
            <h1 className="font-display text-xl text-text">Masuk ke workspace Anda</h1>
            <p className="text-sm text-text-muted mt-1">
              Berjalan lokal di PC ini — tidak ada data yang dikirim ke luar.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Username</label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  className="w-full rounded-lg bg-void-2 border border-border-glass focus:border-cyan/60 focus:outline-none focus:ring-1 focus:ring-cyan/30 text-sm pl-9 pr-3 py-2.5 text-text placeholder:text-text-faint transition-colors"
                  placeholder="admin"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-faint" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-lg bg-void-2 border border-border-glass focus:border-cyan/60 focus:outline-none focus:ring-1 focus:ring-cyan/30 text-sm pl-9 pr-3 py-2.5 text-text placeholder:text-text-faint transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2.5 mt-2 transition-opacity hover:opacity-90 disabled:opacity-50 dbx-glow-cyan"
            >
              {busy ? "Menghubungkan…" : "Masuk"}
              {!busy && <ArrowRight size={15} />}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-text-faint mt-5">
          Akun admin default dibuat otomatis saat backend pertama kali dijalankan.
        </p>
      </div>
    </main>
  );
}
