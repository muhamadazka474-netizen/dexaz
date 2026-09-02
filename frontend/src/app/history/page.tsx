"use client";

import { useEffect, useState } from "react";
import { Trash2, RotateCcw, CheckCircle2, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader, GlassCard } from "@/components/ui";
import { api, Connection, QueryHistoryItem } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function HistoryPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnId, setActiveConnId] = useState<string>("all");
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    api.listConnections().then(setConnections);
  }, []);

  function load() {
    setLoading(true);
    api
      .getQueryHistory(activeConnId === "all" ? undefined : activeConnId, 200)
      .then(setHistory)
      .finally(() => setLoading(false));
  }

  useEffect(load, [activeConnId]);

  async function remove(id: string) {
    await api.deleteHistoryEntry(id);
    load();
  }

  function rerunInEditor() {
    router.push("/sql-editor");
  }

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <PageHeader
          title="Query History"
          subtitle="Riwayat semua query yang pernah dijalankan."
          action={
            <select
              value={activeConnId}
              onChange={(e) => setActiveConnId(e.target.value)}
              className="bg-void-2 border border-border-glass rounded-lg px-3 py-1.5 text-xs text-text"
            >
              <option value="all">Semua koneksi</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          }
        />

        {loading ? (
          <p className="text-sm text-text-muted">Memuat…</p>
        ) : history.length === 0 ? (
          <GlassCard className="p-10 text-center text-sm text-text-muted">
            Belum ada riwayat query. Jalankan query dari SQL Editor untuk melihatnya di sini.
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <GlassCard key={h.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {h.status === "success" ? (
                      <CheckCircle2 size={15} className="text-success" />
                    ) : (
                      <XCircle size={15} className="text-danger" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <pre className="text-xs font-mono text-text whitespace-pre-wrap break-all">{h.sql}</pre>
                    {h.error && <p className="text-xs text-danger mt-1.5">{h.error}</p>}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-text-faint">
                      <span>{new Date(h.executed_at).toLocaleString("id-ID")}</span>
                      <span>{h.row_count.toLocaleString("id-ID")} rows</span>
                      <span>{h.duration_ms.toLocaleString("id-ID")}ms</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={rerunInEditor}
                      title="Buka di SQL Editor"
                      className="text-text-faint hover:text-cyan transition-colors p-1.5"
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      onClick={() => remove(h.id)}
                      title="Hapus"
                      className="text-text-faint hover:text-danger transition-colors p-1.5"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
