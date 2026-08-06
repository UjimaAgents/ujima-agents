"use client";

import { AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";

export function ConfirmDialog({
  isOpen,
  onClose,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  busy = false,
  errorMessage,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "primary";
  busy?: boolean;
  errorMessage?: string;
  onConfirm: () => void | Promise<void>;
}) {
  const confirmClass =
    variant === "primary"
      ? "rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50"
      : "rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} contentClassName="max-w-sm">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
      {errorMessage ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 break-words">{errorMessage}</p>
        </div>
      ) : null}
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onConfirm()}
          className={confirmClass}
        >
          {busy ? "…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
