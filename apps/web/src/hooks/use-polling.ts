"use client";

import { useEffect, useRef } from "react";

type PollTask = () => void | Promise<void>;

export function usePolling(
  task: PollTask,
  options: { intervalMs: number; enabled?: boolean; immediate?: boolean },
): void {
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

  const { intervalMs, enabled = true, immediate = true } = options;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let running = false;
    let timer: number | undefined;

    const run = async () => {
      if (disposed || document.hidden || running) return;
      running = true;
      try {
        await taskRef.current();
      } catch {
        // Poll consumers own their error state; never create an unhandled rejection.
      } finally {
        running = false;
        if (!disposed) timer = window.setTimeout(() => void run(), intervalMs);
      }
    };

    const onVisible = () => {
      if (!document.hidden) void run();
    };

    if (immediate) void run();
    else timer = window.setTimeout(() => void run(), intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, immediate, intervalMs]);
}
