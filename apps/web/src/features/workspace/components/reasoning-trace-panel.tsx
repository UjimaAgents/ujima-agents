"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { RunTraceListResponseSchema, type RunTraceEntry } from "@ujima/api-schema";
import { buildHistoricalTraceSteps } from "../reasoning-trace";
import { TraceStep, type TraceStepData } from "./chat/details-sidebar";

const TRACE_PAGE_SIZE = 15;
const TOP_LOAD_THRESHOLD = 40;

interface TraceRowData {
  key: string;
  step: TraceStepData;
  isLast: boolean;
}

function scrollContainerToBottom(container: HTMLElement) {
  container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
}

function getTraceScrollContainer(root: HTMLDivElement | null) {
  return root?.parentElement?.parentElement ?? null;
}

function matchesTraceFilter(step: TraceStepData, filter: "all" | "errors" | "files" | "shell" | "search") {
  if (filter === "all") return true;
  if (filter === "errors") return step.status === "failed";
  if (filter === "files") return !!step.filesystem || !!step.grep;
  if (filter === "shell") return !!step.terminal;
  if (filter === "search") return !!step.webSearch;
  return true;
}

export function ReasoningTracePanel({
  organizationId,
  threadId,
  conversationName,
  conversationType,
  members,
  liveSteps,
  autoScroll,
}: {
  organizationId?: string;
  threadId?: string;
  conversationName: string;
  conversationType: "channel" | "agent";
  members: { id: string; name: string; kind?: string }[];
  liveSteps: TraceStepData[];
  /** When true, keep the view pinned to the newest trace while it is live. */
  autoScroll?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const shouldScrollToBottomRef = useRef(false);
  const autoFillRef = useRef(false);
  const [history, setHistory] = useState<RunTraceEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [filter, setFilter] = useState<"all" | "errors" | "files" | "shell" | "search">("all");
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const historyEnabled = liveSteps.length === 0 && !!organizationId && !!threadId;

  useEffect(() => {
    if (liveSteps.length > 0 && autoScroll) {
      shouldScrollToBottomRef.current = true;
    }
  }, [autoScroll, liveSteps.length]);

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
      const shouldShow = distFromBottom > 150;
      
      setShowScrollBottom((prev) => (prev !== shouldShow ? shouldShow : prev));
      if (shouldShow) {
        shouldScrollToBottomRef.current = false;
      } else {
        shouldScrollToBottomRef.current = true;
      }

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
      // Do not auto-scroll if the user has manually scrolled up to look at history
      if (showScrollBottom) return;

      const frame = requestAnimationFrame(() => {
        const container = getTraceScrollContainer(rootRef.current);
        if (!container) return;
        scrollContainerToBottom(container);
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [history, liveSteps, showScrollBottom]);

  const traceRows = useMemo<TraceRowData[]>(() => {
    if (liveSteps.length > 0) {
      const filtered = liveSteps.filter((step) => matchesTraceFilter(step, filter));
      return filtered.map((step, index) => ({
        key: step.id,
        step,
        isLast: index === filtered.length - 1,
      }));
    }

    if (!historyEnabled) return [];

    return history.flatMap((entry) => {
      const steps = buildHistoricalTraceSteps({
        conversationName,
        conversationType,
        members,
        run: entry.run,
        steps: entry.steps,
        message: entry.message,
        organizationId,
      });

      const filtered = steps.filter((step) => matchesTraceFilter(step, filter));
      return filtered.map((step, index) => ({
        key: `${entry.run.id}:${step.id}`,
        step,
        isLast: index === filtered.length - 1,
      }));
    });
  }, [
    conversationName,
    conversationType,
    filter,
    history,
    historyEnabled,
    liveSteps,
    members,
    organizationId,
  ]);

  const filterBar = useMemo(
    () => (
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1.5 bg-background/95 pb-3 pt-1.5 backdrop-blur-sm px-1.5">
        {(["all", "errors", "files", "shell", "search"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize transition ${
              filter === f
                ? "bg-violet-600 text-white shadow-sm dark:bg-violet-500"
                : "bg-foreground/5 text-foreground/50 hover:bg-foreground/10 hover:text-foreground/70"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
    ),
    [filter],
  );

  const scrollBottomButton = useMemo(
    () =>
      showScrollBottom ? (
        <div className="sticky bottom-6 z-20 flex justify-center pointer-events-none">
          <button
            onClick={() => {
              shouldScrollToBottomRef.current = true;
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
            Back to bottom
          </button>
        </div>
      ) : null,
    [showScrollBottom],
  );
  const traceEmptyLabel = traceRows.length === 0 ? "No trace steps." : null;
  const traceList = (
    <>
      <div ref={rootRef} className="relative min-h-0">
        <div className="space-y-1.5">
          {traceRows.map((row) => (
            <TraceStep key={row.key} step={row.step} isLast={row.isLast} />
          ))}
        </div>
        {traceEmptyLabel ? <p className="px-1 text-xs text-foreground/50">{traceEmptyLabel}</p> : null}
        {loadingMore ? <p className="px-1 text-[10px] text-foreground/40">Loading older traces...</p> : null}
        {error ? <p className="px-1 text-xs text-red-500">{error}</p> : null}
        <div className="h-px w-full" aria-hidden />
      </div>
      {scrollBottomButton}
    </>
  );

  if (liveSteps.length > 0) {
    return <div className="flex flex-col gap-4">{filterBar}{traceList}</div>;
  }

  if (historyEnabled && history.length === 0) {
    return <p className="text-xs text-foreground/50">Loading traces...</p>;
  }

  if (history.length === 0) {
    return <p className="text-xs text-foreground/50">{error ?? "No trace steps."}</p>;
  }

  return <div className="flex flex-col gap-4">{filterBar}{traceList}</div>;
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

  const response = await fetch(
    `/api/conversations/${encodeURIComponent(input.threadId)}/traces?${params.toString()}`,
    { signal: input.signal },
  );
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message
        : "Unable to load reasoning traces.",
    );
  }

  const parsed = RunTraceListResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Unexpected trace response.");
  }

  return parsed.data;
}
