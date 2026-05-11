"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RunTraceListResponseSchema, type RunTraceEntry } from "@ujima/api-schema";
import { buildHistoricalTraceSteps } from "../reasoning-trace";
import { TraceStep, type TraceStepData } from "./chat/details-sidebar";

const TRACE_PAGE_SIZE = 1;
const TOP_LOAD_THRESHOLD = 40;

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
  const [history, setHistory] = useState<RunTraceEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
    const container = rootRef.current?.parentElement;
    if (!container) return;

    const onScroll = () => {
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

  useLayoutEffect(() => {
    if (pendingPrependRef.current) {
      const { scrollHeight, scrollTop } = pendingPrependRef.current;
      pendingPrependRef.current = null;
      const frame = requestAnimationFrame(() => {
        const container = rootRef.current?.parentElement;
        if (!container) return;
        container.scrollTop = scrollTop + (container.scrollHeight - scrollHeight);
      });
      return () => cancelAnimationFrame(frame);
    }

    if (shouldScrollToBottomRef.current) {
      shouldScrollToBottomRef.current = false;
      const frame = requestAnimationFrame(() => {
        const container = rootRef.current?.parentElement;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [history, liveSteps]);

  const renderedLiveSteps = useMemo(
    () =>
      liveSteps.map((step, index) => (
        <TraceStep key={step.id} step={step} isLast={index === liveSteps.length - 1} />
      )),
    [liveSteps],
  );

  const renderedHistory = useMemo(
    () =>
      history.flatMap((entry) => {
        const steps = buildHistoricalTraceSteps({
          conversationName,
          conversationType,
          members,
          run: entry.run,
          steps: entry.steps,
          message: entry.message,
          organizationId,
        });

        return steps.map((step, index) => (
          <TraceStep
            key={`${entry.run.id}:${step.id}`}
            step={step}
            isLast={index === steps.length - 1}
          />
        ));
      }),
    [conversationName, conversationType, history, members, organizationId],
  );

  if (liveSteps.length > 0) {
    return (
      <div ref={rootRef} className="space-y-0">
        {renderedLiveSteps}
        {error ? <p className="text-xs text-red-500">{error}</p> : null}
        <div className="h-px w-full" aria-hidden />
      </div>
    );
  }

  if (historyEnabled && history.length === 0) {
    return <p className="text-xs text-foreground/50">Loading traces...</p>;
  }

  if (history.length === 0) {
    return <p className="text-xs text-foreground/50">{error ?? "No trace steps."}</p>;
  }

  return (
    <div ref={rootRef} className="space-y-3">
      {renderedHistory}
      {loadingMore ? <p className="px-1 text-[10px] text-foreground/40">Loading older traces...</p> : null}
      {error ? <p className="px-1 text-xs text-red-500">{error}</p> : null}
      <div className="h-px w-full" aria-hidden />
    </div>
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
