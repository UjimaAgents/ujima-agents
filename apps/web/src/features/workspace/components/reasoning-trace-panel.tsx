"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { RunTraceListResponseSchema, type RunTraceEntry } from "@ujima/api-schema";
import { buildHistoricalTraceSteps } from "../reasoning-trace";
import { TraceStep, type TraceStepData } from "./chat/details-sidebar";

const TRACE_PAGE_SIZE = 15;
const TOP_LOAD_THRESHOLD = 40;

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 1) return `${totalSeconds}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}hr`;
}

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

function getDiffStats(body?: string): { additions: number; deletions: number } {
  if (!body) return { additions: 0, deletions: 0 };
  let additions = 0;
  let deletions = 0;
  for (const line of body.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

const AGENT_NAME_SEPARATORS = [
  " sent a message ",
  " responded to ",
  " called tool ",
  " used ",
  " updated ",
  " posted ",
  " created ",
  " ran ",
  " finished ",
  " · ",
];

function getAgentName(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return "Agent";
  for (const sep of AGENT_NAME_SEPARATORS) {
    const idx = trimmed.indexOf(sep);
    if (idx > 0) return trimmed.slice(0, idx);
  }
  const space = trimmed.indexOf(" ");
  return space > 0 ? trimmed.slice(0, space) : trimmed;
}

type AggregatedOperation = NonNullable<TraceStepData["aggregatedOperations"]>[number];

function parseLineRange(meta: string): string | undefined {
  const range = meta.match(/startLine=(\d+),\s*endLine=(\d+)/i);
  if (range) return `${range[1]}-${range[2]}`;
  const offset = meta.match(/offset=(\d+),\s*limit=(\d+)/i);
  if (offset) {
    const start = Number.parseInt(offset[1], 10);
    const limit = Number.parseInt(offset[2], 10);
    return `${start}-${start + limit - 1}`;
  }
  return undefined;
}

function toolStepToOperation(step: TraceStepData): AggregatedOperation {
  const base = { id: step.id, additions: 0, deletions: 0, status: step.status };

  if (step.filesystem) {
    const isWrite = step.filesystem.action === "write";
    const isDelete = step.title.toLowerCase().includes("deleted");
    const body = step.filesystem.body || "";
    return {
      ...base,
      type: isDelete ? "delete" : isWrite ? "edit" : "read",
      file: step.filesystem.resourcePath,
      body,
      lines: step.filesystem.meta ? parseLineRange(step.filesystem.meta) : undefined,
      ...(isWrite || isDelete ? getDiffStats(body) : {}),
    };
  }
  if (step.grep) {
    return { ...base, type: "search", query: step.grep.query, file: step.grep.path };
  }
  if (step.webSearch) {
    return { ...base, type: "search", query: step.webSearch.query };
  }
  if (step.terminal) {
    return {
      ...base,
      type: "shell",
      command: step.terminal.commandLine,
      file: step.terminal.cwd,
      terminal: step.terminal,
    };
  }

  const calledIdx = step.title.indexOf(" called tool ");
  const toolName = calledIdx >= 0 ? step.title.slice(calledIdx + " called tool ".length).trim() : "tool";
  if (toolName.startsWith("memory.")) {
    return { ...base, type: "memory", toolName, detail: step.detail || "" };
  }
  if (toolName.startsWith("goal.")) {
    return { ...base, type: "goal", toolName, detail: step.detail || "" };
  }
  if (toolName.startsWith("question.")) {
    return { ...base, type: "question", toolName, detail: step.detail || "" };
  }
  if (toolName.startsWith("self.procedure.")) {
    return { ...base, type: "procedure", toolName, detail: step.detail || "" };
  }
  return { ...base, type: "tool", toolName, detail: step.detail || "" };
}

function isToolStep(step: TraceStepData): boolean {
  return !!(
    step.filesystem ||
    step.grep ||
    step.webSearch ||
    step.terminal ||
    step.id.startsWith("tool:") ||
    step.title.includes(" called tool ")
  );
}

function groupTraceSteps(steps: TraceStepData[]): TraceStepData[] {
  const grouped: TraceStepData[] = [];
  let currentGroup: (TraceStepData & { aggregatedOperations: AggregatedOperation[] }) | null = null;

  for (const step of steps) {
    if (isToolStep(step)) {
      if (!currentGroup) {
        currentGroup = {
          id: `aggregated-run-${step.id}`,
          title: `${getAgentName(step.title)} · running`,
          detail: "",
          time: step.time,
          duration: step.duration,
          status: step.status,
          aggregatedOperations: [],
        };
        grouped.push(currentGroup);
      }
      currentGroup.aggregatedOperations.push(toolStepToOperation(step));
      currentGroup.status = currentGroup.aggregatedOperations.some((op) => op.status === "failed")
        ? "failed"
        : step.status === "running"
          ? "running"
          : "success";
      currentGroup.title = `${getAgentName(currentGroup.title)} · ${
        currentGroup.status === "failed"
          ? "failed"
          : currentGroup.status === "running"
            ? "running"
            : "completed"
      }`;
      currentGroup.duration = step.duration;
      continue;
    }

    if (step.title.startsWith("Run ·")) {
      currentGroup = {
        id: `aggregated-run-${step.id}`,
        title: `${getAgentName(step.title)} · ${step.status}`,
        detail: "",
        time: step.time,
        duration: step.duration,
        status: step.status,
        aggregatedOperations: [],
      };
      grouped.push(currentGroup);
      continue;
    }

    currentGroup = null;
    grouped.push(step);
  }

  return grouped;
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
  const autoFillRef = useRef(false);
  const [history, setHistory] = useState<RunTraceEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [filter, setFilter] = useState<"all" | "errors" | "files" | "shell" | "search">("all");
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  const startedAtMs = useMemo(() => {
    if (!startedAt) return undefined;
    const ms = Date.parse(startedAt);
    return Number.isFinite(ms) ? ms : undefined;
  }, [startedAt]);
  const elapsed = startedAtMs === undefined ? undefined : formatElapsed(now - startedAtMs);

  useEffect(() => {
    if (startedAtMs === undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAtMs]);

  const historyEnabled = !!organizationId && !!threadId;

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
          }).filter((step) => matchesTraceFilter(step, filter));
        })
      : [];

    const liveFiltered = liveSteps.filter((step) => matchesTraceFilter(step, filter));

    // Deduplicate any overlapping steps by ID
    const historyStepIds = new Set(historySteps.map((step) => step.id));
    const uniqueLiveSteps = liveFiltered.filter((step) => !historyStepIds.has(step.id));

    const rawSteps = [...historySteps, ...uniqueLiveSteps];
    const grouped = groupTraceSteps(rawSteps);

    return grouped.map((step, index) => ({
      key: step.id,
      step,
      isLast: index === grouped.length - 1,
    }));
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
      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1.5 pb-3 pt-1.5 backdrop-blur-sm">
        <div className="flex flex-wrap gap-1.5">
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
            <TraceStep
              key={row.key}
              step={row.step}
              isLast={row.isLast && !elapsed}
            />
          ))}
          {elapsed ? (
            <div className="relative pl-6 pb-2 pt-1 animate-in fade-in duration-300">
              {traceRows.length > 0 ? (
                <div
                  className="absolute left-1 -top-2 h-4 w-px bg-foreground/10"
                  aria-hidden
                />
              ) : null}
              <div
                className="absolute left-0 top-1.5 z-[1] h-2 w-2 rounded-full bg-violet-500 animate-ping"
                aria-hidden
              />
              <div
                className="absolute left-0 top-1.5 z-[1] h-2 w-2 rounded-full bg-violet-600 ring-[3px] ring-violet-500/20 dark:bg-violet-500"
                aria-hidden
              />
              <div className="flex items-center gap-2 text-[11px] font-semibold text-violet-600/90 dark:text-violet-400/90 tabular-nums">
                <Loader2 className="h-3 w-3 animate-spin shrink-0 text-violet-500" />
                <span>Working for {elapsed}</span>
              </div>
            </div>
          ) : null}
        </div>
        {traceEmptyLabel ? (
          <TraceEmpty
            label={filter === "all" ? "No trace steps yet." : `No ${filter} steps.`}
            detail={liveSteps.length > 0 ? "The agent is active, but this filter has no matching events." : undefined}
          />
        ) : null}
        {loadingMore ? <p className="px-1 text-[10px] text-foreground/40">Loading older traces...</p> : null}
        {error ? <p className="px-1 text-xs text-red-500">{error}</p> : null}
        <div className="h-px w-full" aria-hidden />
      </div>
      {scrollBottomButton}
    </>
  );

  if (traceRows.length > 0 || elapsed) {
    return <div className="flex flex-col gap-4">{filterBar}{traceList}</div>;
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
