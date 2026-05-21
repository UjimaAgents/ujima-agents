"use client";

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
  onConfirm: () => void | Promise<void>;
}) {
  const confirmClass =
    variant === "primary"
      ? "rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50"
      : "rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} contentClassName="max-w-sm">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
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
