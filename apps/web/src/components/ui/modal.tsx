"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  contentClassName?: string;
}

export function Modal({ isOpen, onClose, title, children, contentClassName = "" }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 py-6">
      <div
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm transition-opacity animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div
        className={`relative my-auto flex max-h-[calc(100vh-3rem)] w-full transform flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl transition-all animate-in zoom-in-95 duration-300 dark:border-zinc-800 dark:bg-[#09090b] ${contentClassName || "max-w-md"}`}
      >
        <div className="absolute -top-24 -left-24 h-48 w-48 rounded-full bg-violet-500/10 blur-[80px]" />
        {title ? (
          <div className="relative mb-6 flex shrink-0 items-center justify-between">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
