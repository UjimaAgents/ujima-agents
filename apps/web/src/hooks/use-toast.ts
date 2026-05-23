"use client";

import { useCallback } from "react";
import { useToastStore, type ToastType } from "@/lib/toast-store";

export function useToast() {
  const addToast = useToastStore((state) => state.addToast);

  const toast = useCallback(
    (type: ToastType, title: string, description?: string, duration?: number) => {
      return addToast({ type, title, description, duration });
    },
    [addToast],
  );

  const success = useCallback(
    (title: string, description?: string) => toast("success", title, description),
    [toast],
  );

  const error = useCallback(
    (title: string, description?: string) => toast("error", title, description),
    [toast],
  );

  const warning = useCallback(
    (title: string, description?: string) => toast("warning", title, description),
    [toast],
  );

  const info = useCallback(
    (title: string, description?: string) => toast("info", title, description),
    [toast],
  );

  return { toast, success, error, warning, info };
}
