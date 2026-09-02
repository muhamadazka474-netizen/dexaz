import { ReactNode } from "react";

export function GlassCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`dbx-glass rounded-xl ${className}`}>{children}</div>;
}

export function StatCard({
  label,
  value,
  icon,
  accent = "cyan",
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  accent?: "cyan" | "blue" | "violet";
}) {
  const accentClass = {
    cyan: "text-cyan bg-cyan/10",
    blue: "text-blue bg-blue/10",
    violet: "text-violet bg-violet/10",
  }[accent];

  return (
    <GlassCard className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-text-muted mb-2">{label}</p>
          <p className="font-display text-2xl text-text tabular-nums">
            {typeof value === "number" ? value.toLocaleString("id-ID") : value}
          </p>
        </div>
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${accentClass}`}>
          {icon}
        </div>
      </div>
    </GlassCard>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="font-display text-xl text-text">{title}</h1>
        {subtitle && <p className="text-sm text-text-muted mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
