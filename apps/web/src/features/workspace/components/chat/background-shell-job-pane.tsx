"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Square, Terminal } from "lucide-react";
import type { ShellJobDetail } from "@ujima/api-schema";
import {
  TERMINAL_COMMAND_ROW,
  TERMINAL_CWD,
  TERMINAL_PANEL,
  TERMINAL_PROMPT,
  TERMINAL_SECTION,
} from "./terminal-chrome";
import { ExpandableOutput } from "./expandable-output";

const POLL_MS = 700;

function combineStreams(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.trim()) parts.push(stdout.trimEnd());
  if (stderr.trim()) parts.push(`stderr:\n${stderr.trimEnd()}`);
  return parts.join("\n\n").trim();
}

export function BackgroundShellJobPane({
  className = "",
  cwd,
  commandLine,
  runId,
  jobId,
  organizationId,
}: {
  className?: string;
  cwd: string;
  commandLine: string;
  runId: string;
  jobId: string;
  organizationId: string;
}) {
  const [snapshot, setSnapshot] = useState<ShellJobDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchSnapshot = useCallback(async () => {
    const qs = new URLSearchParams({ organizationId });
    const res = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/jobs/${encodeURIComponent(jobId)}?${qs.toString()}`,
      { method: "GET", credentials: "include" },
    );
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const msg =
        typeof body === "object" &&
        body &&
        "message" in body &&
        typeof (body as { message?: string }).message === "string"
          ? (body as { message: string }).message
          : `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return body as ShellJobDetail;
  }, [organizationId, runId, jobId]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const schedulePolling = () => {
      timer = setInterval(() => {
        void (async () => {
          try {
            const next = await fetchSnapshot();
            if (cancelled) return;
            setLoadError(null);
            setSnapshot(next);
            if (next.status !== "running" && timer) {
              clearInterval(timer);
              timer = undefined;
            }
          } catch (e) {
            if (cancelled) return;
            setLoadError(e instanceof Error ? e.message : "Failed to load job output");
          }
        })();
      }, POLL_MS);
    };

    void (async () => {
      try {
        const next = await fetchSnapshot();
        if (cancelled) return;
        setLoadError(null);
        setSnapshot(next);
        if (next.status === "running") schedulePolling();
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load job output");
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [fetchSnapshot]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [snapshot?.stdout, snapshot?.stderr, snapshot?.status]);

  const combined =
    snapshot != null ? combineStreams(snapshot.stdout, snapshot.stderr) : "";

  const handleStop = async () => {
    setStopping(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/jobs/${encodeURIComponent(jobId)}/terminate`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      try {
        const next = await fetchSnapshot();
        setSnapshot(next);
      } catch {
        setSnapshot((prev: ShellJobDetail | null) =>
          prev
            ? {...prev, status: "exited"}
            : {
                id: jobId,
                status: "exited",
                cwd,
                commandLine,
                stdout: "",
                stderr: "",
              },
        );
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setStopping(false);
    }
  };

  const showRunning = snapshot?.status === "running";
  const tone =
    snapshot?.status === "error" || loadError ? "error" : "default";
  const hasOutputContent = Boolean(
    loadError ||
    combined.trim().length > 0 ||
    showRunning ||
    snapshot?.status === "exited" ||
    snapshot?.error
  );

  return (
    <div className={`${TERMINAL_PANEL} ${className}`}>
      <div
        className={`${TERMINAL_SECTION} flex items-start justify-between gap-2 border-b border-violet-500/[0.06] px-2 py-1 dark:border-white/10`}
      >
        <div className="min-w-0 flex-1">
          <div className={`${TERMINAL_CWD} flex items-center gap-1.5`}>
            <Terminal className="h-3.5 w-3.5 shrink-0 text-foreground/45" />
            <span>{cwd}</span>
          </div>
          <div className={`${TERMINAL_COMMAND_ROW} flex items-start gap-1.5`}>
            <span className={TERMINAL_PROMPT}>$ </span>
            <span className="break-all">{commandLine}</span>
          </div>
        </div>
        {showRunning ? (
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={stopping}
            className="mt-1 flex shrink-0 items-center gap-1 rounded-md border border-red-500/25 bg-red-500/[0.08] px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-500/[0.14] disabled:opacity-50 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300"
          >
            {stopping ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Square className="h-3 w-3 fill-current" aria-hidden />
            )}
            Stop
          </button>
        ) : null}
      </div>
      {hasOutputContent ? (
        <ExpandableOutput>
          <div
            className={`px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
              tone === "error"
                ? "text-red-700 dark:text-red-300/90"
                : "text-foreground/85"
            }`}
          >
            {loadError ? (
              <span className="text-red-700 dark:text-red-300/90">{loadError}</span>
            ) : combined ? (
              combined
            ) : showRunning ? (
              <span className="text-foreground/45">Waiting for output…</span>
            ) : snapshot?.status === "exited" ? (
              <span className="text-foreground/45">
                {snapshot.exitCode != null
                  ? `Finished (exit ${snapshot.exitCode})`
                  : "Finished"}
              </span>
            ) : null}
            {snapshot?.error ? (
              <div className="mt-2 border-t border-foreground/10 pt-2 text-red-700 dark:text-red-300/90">
                {snapshot.error}
              </div>
            ) : null}
            <div ref={bottomRef} className="h-px w-full shrink-0" aria-hidden />
          </div>
        </ExpandableOutput>
      ) : null}
    </div>
  );
}
