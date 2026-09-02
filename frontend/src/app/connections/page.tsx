"use client";

import { useEffect, useState } from "react";
import { Plus, Plug, Loader2, CheckCircle2, XCircle, Trash2, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader, GlassCard } from "@/components/ui";
import { AddConnectionModal } from "@/components/AddConnectionModal";
import { api, Connection, ApiError } from "@/lib/api";

type Status = "unknown" | "testing" | "connected" | "failed";

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [statuses, setStatuses] = useState<Record<string, { status: Status; message?: string }>>({});
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api
      .listConnections()
      .then(setConnections)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Gagal memuat koneksi"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function testOne(id: string) {
    setStatuses((s) => ({ ...s, [id]: { status: "testing" } }));
    try {
      const res = await api.testConnection(id);
      setStatuses((s) => ({
        ...s,
        [id]: { status: res.success ? "connected" : "failed", message: res.message },
      }));
    } catch (e) {
      setStatuses((s) => ({
        ...s,
        [id]: { status: "failed", message: e instanceof ApiError ? e.message : "Error" },
      }));
    }
  }

  async function remove(id: string) {
    if (!confirm("Hapus koneksi ini? Tindakan ini tidak dapat dibatalkan.")) return;
    await api.deleteConnection(id);
    load();
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">
        <PageHeader
          title="Database Connections"
          subtitle="Kelola koneksi ke PostgreSQL lokal Anda."
          action={
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan to-blue text-void font-medium text-sm py-2 px-4 hover:opacity-90 transition-opacity dbx-glow-cyan"
            >
              <Plus size={15} />
              Add Connection
            </button>
          }
        />

        {error && <GlassCard className="p-4 mb-4 border-danger/30 text-danger text-sm">{error}</GlassCard>}

        {loading ? (
          <div className="text-text-muted text-sm flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Memuat…
          </div>
        ) : connections.length === 0 ? (
          <GlassCard className="p-10 text-center">
            <Plug size={28} className="mx-auto text-text-faint mb-3" />
            <p className="text-text-muted text-sm">
              Belum ada koneksi database. Tambahkan koneksi PostgreSQL lokal pertama Anda.
            </p>
          </GlassCard>
        ) : (
          <div className="grid gap-3">
            {connections.map((c) => {
              const st = statuses[c.id];
              return (
                <GlassCard key={c.id} className="p-4 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-blue/10 flex items-center justify-center text-blue shrink-0">
                    <Plug size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text truncate">{c.name}</p>
                      <span className="text-[10px] uppercase tracking-wide text-text-faint border border-border-glass rounded px-1.5 py-0.5">
                        {c.db_type}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted font-mono truncate mt-0.5">
                      {c.username}@{c.host}:{c.port}/{c.database_name}
                    </p>
                    {st?.status === "failed" && st.message && (
                      <p className="text-xs text-danger mt-1 truncate">{st.message}</p>
                    )}
                  </div>

                  <StatusPill status={st?.status ?? "unknown"} />

                  <button
                    onClick={() => testOne(c.id)}
                    disabled={st?.status === "testing"}
                    className="text-xs flex items-center gap-1.5 rounded-lg border border-border-glass text-text-muted hover:text-text px-3 py-1.5 transition-colors"
                  >
                    <RefreshCw size={12} className={st?.status === "testing" ? "animate-spin" : ""} />
                    Test
                  </button>
                  <button
                    onClick={() => remove(c.id)}
                    className="text-text-faint hover:text-danger transition-colors p-1.5"
                    title="Hapus koneksi"
                  >
                    <Trash2 size={15} />
                  </button>
                </GlassCard>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <AddConnectionModal onClose={() => setShowModal(false)} onCreated={load} />
      )}
    </AppShell>
  );
}

function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { label: string; className: string; icon: React.ReactNode }> = {
    unknown: {
      label: "Belum diuji",
      className: "text-text-faint border-border-glass",
      icon: <span className="h-1.5 w-1.5 rounded-full bg-text-faint" />,
    },
    testing: {
      label: "Menguji…",
      className: "text-warning border-warning/30",
      icon: <Loader2 size={11} className="animate-spin" />,
    },
    connected: {
      label: "Connected",
      className: "text-success border-success/30",
      icon: <CheckCircle2 size={11} />,
    },
    failed: {
      label: "Failed",
      className: "text-danger border-danger/30",
      icon: <XCircle size={11} />,
    },
  };
  const s = map[status];
  return (
    <span className={`shrink-0 flex items-center gap-1.5 text-[11px] border rounded-full px-2.5 py-1 ${s.className}`}>
      {s.icon}
      {s.label}
    </span>
  );
}
