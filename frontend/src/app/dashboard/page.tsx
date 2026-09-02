"use client";

import { useEffect, useState } from "react";
import { Plug, Table2, Eye, Terminal, Star } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PageHeader, StatCard, GlassCard } from "@/components/ui";
import { TableSummaryPanel } from "@/components/TableSummaryPanel";
import { api, DashboardSummary } from "@/lib/api";

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .dashboardSummary()
      .then(setSummary)
      .catch((e) => setError(e.message || "Gagal memuat ringkasan"));
  }, []);

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <PageHeader
          title="Dashboard"
          subtitle="Ringkasan koneksi database dan aktivitas query Anda."
        />

        {error && (
          <GlassCard className="p-4 mb-6 border-danger/30 text-danger text-sm">{error}</GlassCard>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCard
            label="Connections"
            value={summary?.connections ?? "–"}
            icon={<Plug size={16} />}
            accent="cyan"
          />
          <StatCard
            label="Tables"
            value={summary?.tables ?? "–"}
            icon={<Table2 size={16} />}
            accent="blue"
          />
          <StatCard
            label="Views"
            value={summary?.views ?? "–"}
            icon={<Eye size={16} />}
            accent="violet"
          />
          <StatCard
            label="Queries Run"
            value={summary?.queries_run ?? "–"}
            icon={<Terminal size={16} />}
            accent="cyan"
          />
          <StatCard
            label="Saved Queries"
            value={summary?.saved_queries ?? "–"}
            icon={<Star size={16} />}
            accent="blue"
          />
        </div>

        <GlassCard className="p-6 mt-6">
          <h2 className="font-display text-base text-text mb-2">Mulai dari sini</h2>
          <p className="text-sm text-text-muted leading-relaxed max-w-2xl">
            Tambahkan koneksi PostgreSQL lokal Anda di halaman{" "}
            <span className="text-cyan">Connections</span>, lalu buka{" "}
            <span className="text-cyan">Explorer</span> untuk melihat schema, tabel, dan data
            secara otomatis — tanpa perlu mengatur apa pun secara manual. Fitur SQL Editor, SQL
            Library, dan Query Builder akan hadir di fase pengembangan berikutnya.
          </p>
        </GlassCard>

        <TableSummaryPanel />
      </div>
    </AppShell>
  );
}
