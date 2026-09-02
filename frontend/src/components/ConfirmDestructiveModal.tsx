"use client";

import { AlertTriangle, X } from "lucide-react";

export function ConfirmDestructiveModal({
  warning,
  onConfirm,
  onCancel,
}: {
  warning: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="dbx-glass-strong rounded-2xl w-full max-w-md p-6 relative border-danger/30">
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-text-faint hover:text-text transition-colors"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2.5 mb-3">
          <div className="h-9 w-9 rounded-lg bg-danger/10 flex items-center justify-center text-danger shrink-0">
            <AlertTriangle size={17} />
          </div>
          <h2 className="font-display text-base text-text">Konfirmasi diperlukan</h2>
        </div>

        <p className="text-sm text-text-muted leading-relaxed mb-6">{warning}</p>

        <div className="flex items-center gap-2">
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-danger/90 hover:bg-danger text-void font-medium text-sm py-2.5 transition-colors"
          >
            Execute Anyway
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg border border-border-glass text-text-muted hover:text-text text-sm py-2.5 px-4 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
