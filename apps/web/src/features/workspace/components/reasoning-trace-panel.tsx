"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { RunTraceListResponseSchema, type RunTraceEntry } from "@ujima/api-schema";
import { buildHistoricalTraceSteps } from "../reasoning-trace";
import { groupTraceSteps } from "../trace-grouping";
import { TraceStep } from "./chat/details-sidebar";
import type { TraceStepData } from "./chat/trace-types";
import { TRACE_ROW_STYLE } from "./chat/trace-layout";
import { clientFetchJson } from "@/lib/client-api";

const TRACE_PAGE_SIZE = 8;
const TOP_LOAD_THRESHOLD = 40;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) return `${totalSeconds}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}hr`;
}

const ElapsedBadge = memo(function ElapsedBadge({ startedAtMs }: { startedAtMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <span>Working for {formatElapsed(now - startedAtMs)}</span>;
});

interface TraceRowData {
  key: string;
  step: TraceStepData;
  isLast: boolean;
  autoOpen: boolean;
}

function scrollContainerToBottom(container: HTMLElement) {
  container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
}

function getTraceScrollContainer(root: HTMLDivElement | null) {
  return root?.parentElement?.parentElement ?? null;
}


function TraceEmpty({ label, detail, loading }: { label: string; detail?: string; loading?: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-foreground/10 px-3 py-4 text-xs text-foreground/50">
      <div className="flex items-center gap-2 font-medium text-foreground/60">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {label}
      </div>
      {detail ? <p className="mt-1 text-[11px] leading-4 text-foreground/40">{detail}</p> : null}
    </div>
  );
}

export function ReasoningTracePanel({
  organizationId,
  threadId,
  conversationName,
  conversationType,
  members,
  liveSteps,
  autoScroll,
  startedAt,
}: {
  organizationId?: string;
  threadId?: string;
  conversationName: string;
  conversationType: "channel" | "agent";
  members: { id: string; name: string; kind?: string }[];
  liveSteps: TraceStepData[];
  /** When true, keep the view pinned to the newest trace while it is live. */
  autoScroll?: boolean;
  startedAt?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const shouldScrollToBottomRef = useRef(false);
  const isAtBottomRef = useRef(true);
  const prevLiveStepsCountRef = useRef(0);
  const prevLiveSignalRef = useRef("");
  const autoFillRef = useRef(false);
  const [history, setHistory] = useState<RunTraceEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [newTraceCount, setNewTraceCount] = useState(0);

  const startedAtMs = useMemo(() => {
    if (!startedAt) return undefined;
    const ms = Date.parse(startedAt);
    return Number.isFinite(ms) ? ms : undefined;
  }, [startedAt]);
  const historyEnabled = !!organizationId && !!threadId;

  useEffect(() => {
    if (!historyEnabled) return;

    const controller = new AbortController();
    shouldScrollToBottomRef.current = true;

    void loadTracePage({
      organizationId,
      threadId,
      limit: TRACE_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted) return;
        setHistory(page.data.slice().reverse());
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setError(undefined);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Unable to load reasoning traces.");
      });

    return () => {
      controller.abort();
    };
  }, [historyEnabled, organizationId, threadId]);

  useEffect(() => {
    const container = getTraceScrollContainer(rootRef.current);
    if (!container) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distFromBottom = scrollHeight - scrollTop - clientHeight;
      const atBottom = distFromBottom < 96;
      const shouldShow = distFromBottom > 150;

      isAtBottomRef.current = atBottom;
      setShowScrollBottom((prev) => (prev !== shouldShow ? shouldShow : prev));
      shouldScrollToBottomRef.current = atBottom;
      if (atBottom) setNewTraceCount(0);

      if (!historyEnabled || loadingMore || !hasMore || !cursor) return;
      if (container.scrollTop > TOP_LOAD_THRESHOLD) return;

      pendingPrependRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
      setLoadingMore(true);

      void loadTracePage({
        organizationId,
        threadId,
        cursor,
        limit: TRACE_PAGE_SIZE,
      })
      .then((page) => {
        setHistory((current) => [...page.data.slice().reverse(), ...current]);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Unable to load older traces.");
        })
        .finally(() => {
          setLoadingMore(false);
        });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [cursor, hasMore, historyEnabled, loadingMore, organizationId, threadId]);

  useEffect(() => {
    const container = getTraceScrollContainer(rootRef.current);
    if (!historyEnabled || loadingMore || autoFillRef.current) return;
    if (!container || history.length === 0 || !hasMore || !cursor) return;
    if (container.scrollHeight > container.clientHeight + 1) return;

    autoFillRef.current = true;
    let cancelled = false;

    void loadTracePage({
      organizationId,
      threadId,
      cursor,
      limit: TRACE_PAGE_SIZE,
    })
      .then((page) => {
        if (cancelled) return;
        setHistory((current) => [...page.data.slice().reverse(), ...current]);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load older traces.");
      })
      .finally(() => {
        autoFillRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [cursor, hasMore, history.length, historyEnabled, loadingMore, organizationId, threadId]);

  useLayoutEffect(() => {
    if (pendingPrependRef.current) {
      const { scrollHeight, scrollTop } = pendingPrependRef.current;
      pendingPrependRef.current = null;
      const frame = requestAnimationFrame(() => {
        const container = getTraceScrollContainer(rootRef.current);
        if (!container) return;
        if (shouldScrollToBottomRef.current) {
          scrollContainerToBottom(container);
          return;
        }
        container.scrollTop = scrollTop + (container.scrollHeight - scrollHeight);
      });
      return () => cancelAnimationFrame(frame);
    }

    if (shouldScrollToBottomRef.current) {
      const frame = requestAnimationFrame(() => {
        const container = getTraceScrollContainer(rootRef.current);
        if (!container) return;
        scrollContainerToBottom(container);
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [history, liveSteps]);

  useEffect(() => {
    let nextNewTraceCount: SetStateAction<number> | undefined;
    const nextCount = liveSteps.length;
    const last = liveSteps.at(-1);
    const nextSignal = nextCount ? `${last?.id ?? ""}:${last?.status ?? ""}:${last?.title ?? ""}:${last?.detail ?? ""}` : "";
    const prevCount = prevLiveStepsCountRef.current;
    const prevSignal = prevLiveSignalRef.current;

    prevLiveStepsCountRef.current = nextCount;
    prevLiveSignalRef.current = nextSignal;

    if (nextCount === 0) {
      nextNewTraceCount = 0;
    } else if (nextSignal === prevSignal && nextCount === prevCount) {
      nextNewTraceCount = undefined;
    } else if (isAtBottomRef.current && autoScroll) {
      shouldScrollToBottomRef.current = true;
      nextNewTraceCount = 0;
    } else if (nextCount > prevCount) {
      shouldScrollToBottomRef.current = false;
      nextNewTraceCount = (count) => count + (nextCount - prevCount);
    }

    if (nextNewTraceCount === undefined) return;
    const frame = requestAnimationFrame(() => setNewTraceCount(nextNewTraceCount));
    return () => cancelAnimationFrame(frame);
  }, [autoScroll, liveSteps]);

  const traceRows = useMemo<TraceRowData[]>(() => {
    const historySteps = historyEnabled
      ? history.flatMap((entry) => {
          return buildHistoricalTraceSteps({
            conversationName,
            conversationType,
            members,
            run: entry.run,
            steps: entry.steps,
            message: entry.message,
            organizationId,
          });
        })
      : [];

    const liveFiltered = liveSteps;

    // Deduplicate any overlapping steps by ID
    const historyStepIds = new Set(historySteps.map((step) => step.id));
    const uniqueLiveSteps = liveFiltered.filter((step) => !historyStepIds.has(step.id));

    const rawSteps = [...historySteps, ...uniqueLiveSteps];
    const grouped = groupTraceSteps(rawSteps);
    let lastToolGroupIndex = -1;
    for (let index = grouped.length - 1; index >= 0; index -= 1) {
      if (grouped[index]?.aggregatedOperations?.length) {
        lastToolGroupIndex = index;
        break;
      }
    }

    return grouped.map((step, index) => ({
      key: step.id,
      step,
      isLast: index === grouped.length - 1,
      autoOpen: index === lastToolGroupIndex,
    }));
  }, [
    conversationName,
    conversationType,
    history,
    historyEnabled,
    liveSteps,
    members,
    organizationId,
  ]);

  const scrollBottomButton = useMemo(
    () =>
      newTraceCount > 0 ? (
        <div className="sticky bottom-6 z-20 flex justify-center pointer-events-none">
          <button
            onClick={() => {
              shouldScrollToBottomRef.current = true;
              isAtBottomRef.current = true;
              setNewTraceCount(0);
              const container = getTraceScrollContainer(rootRef.current);
              if (container) {
                container.scrollTo({
                  top: Math.max(0, container.scrollHeight - container.clientHeight),
                  behavior: "smooth",
                });
              }
            }}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-[10px] font-bold text-white shadow-xl shadow-violet-500/30 transition hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom-4 duration-300"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {newTraceCount === 1 ? "1 new message" : `${newTraceCount} new messages`}
          </button>
        </div>
      ) : showScrollBottom ? (
        <div className="sticky bottom-6 z-20 flex justify-center pointer-events-none">
          <button
            onClick={() => {
              shouldScrollToBottomRef.current = true;
              isAtBottomRef.current = true;
              const container = getTraceScrollContainer(rootRef.current);
              if (container) {
                container.scrollTo({
                  top: Math.max(0, container.scrollHeight - container.clientHeight),
                  behavior: "smooth",
                });
              }
            }}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-zinc-200/50 bg-white/30 px-4 py-2 text-[10px] font-bold text-zinc-800 shadow-xl backdrop-blur-sm transition hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-bottom-4 duration-300 dark:border-zinc-800/50 dark:bg-[#09090b]/30 dark:text-zinc-200"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Back to bottom
          </button>
        </div>
      ) : null,
    [newTraceCount, showScrollBottom],
  );
  const traceEmptyLabel = traceRows.length === 0 ? "No trace steps." : null;
  const traceList = (
    <>
      <div ref={rootRef} className="relative min-h-0">
        <div>
          {loadingMore ? (
            <div className="sticky top-0 z-10 -mx-1 mb-1 flex items-center gap-2 bg-background/90 px-1 py-1 text-[10px] text-foreground/40 backdrop-blur">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading older traces...
            </div>
          ) : null}
          {traceRows.map((row) => (
            <TraceStep
              key={row.key}
              step={row.step}
              isLast={row.isLast && startedAtMs === undefined}
              autoOpen={row.autoOpen}
            />
          ))}
          {startedAtMs !== undefined ? (
            <div
              className="relative min-w-0 pb-2 pt-1 animate-in fade-in duration-300"
              style={TRACE_ROW_STYLE}
            >
              {traceRows.length > 0 ? (
                <div
                  className="pointer-events-none absolute -top-2 left-2.5 h-4 w-px bg-foreground/10"
                  aria-hidden="true"
                />
              ) : null}
              <div className="relative z-[1] flex h-5 w-5 items-center justify-center">
                <span
                  className="h-2.5 w-2.5 rounded-full bg-zinc-400 ring-[3px] ring-zinc-400/20 dark:bg-zinc-500 dark:ring-zinc-500/20"
                  aria-hidden="true"
                />
              </div>
              <div className="flex min-h-5 items-center gap-2 text-[11px] font-semibold text-foreground/55 tabular-nums">
                <Loader2 className="h-3 w-3 animate-spin shrink-0 text-foreground/45" />
                <ElapsedBadge startedAtMs={startedAtMs} />
              </div>
            </div>
          ) : null}
        </div>
        {traceEmptyLabel ? (
          <TraceEmpty
            label="No trace steps yet."
            detail={undefined}
          />
        ) : null}
        {error ? <p className="px-1 text-xs text-red-500">{error}</p> : null}
        <div className="h-px w-full" aria-hidden />
      </div>
      {scrollBottomButton}
    </>
  );

  if (traceRows.length > 0 || startedAtMs !== undefined) {
    return <div className="flex flex-col gap-4">{traceList}</div>;
  }

  if (loadingMore || (historyEnabled && history.length === 0 && !error)) {
    return <TraceEmpty label="Loading traces..." loading />;
  }

  return (
    <TraceEmpty
      label={error ?? "No trace steps yet."}
      detail="Reasoning and tool activity will appear here while the agent works."
    />
  );
}

async function loadTracePage(input: {
  organizationId: string;
  threadId: string;
  cursor?: string;
  limit: number;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams({
    organizationId: input.organizationId,
    limit: String(input.limit),
  });
  if (input.cursor) params.set("cursor", input.cursor);

  const body = await clientFetchJson<unknown>(
    `/api/conversations/${encodeURIComponent(input.threadId)}/traces?${params.toString()}`,
    { signal: input.signal },
    "Unable to load reasoning traces.",
  );

  const parsed = RunTraceListResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Unexpected trace response.");
  }

  return parsed.data;
}
