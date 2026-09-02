"use client";

import { AppShell } from "@/components/AppShell";

// Referensi SQL menampilkan situs statis "SQL // Command Lab" (lihat
// public/sql-reference/) di dalam iframe. Situs ini punya tema, sidebar,
// dan pencarian sendiri yang berbeda dari desain DBXplorer, jadi dirender
// apa adanya lewat iframe alih-alih dipecah ulang menjadi komponen React —
// ini menjaga tampilan & interaksi aslinya (scroll spy, search, copy
// button, dsb.) tetap utuh tanpa risiko pecah saat di-port.
export default function ReferencePage() {
  return (
    <AppShell>
      <div className="h-[calc(100vh-4rem)]">
        <iframe
          src="/sql-reference/index.html"
          title="Referensi SQL"
          className="w-full h-full border-0"
        />
      </div>
    </AppShell>
  );
}
