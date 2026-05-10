"use client";

import { useLayoutEffect, useRef } from "react";
import { TraceStep, type TraceStepData } from "./chat/details-sidebar";

export function ReasoningTracePanel({
  steps,
  autoScroll,
}: {
  steps: TraceStepData[];
  /** When true, keep scrolled to the latest step (e.g. while details are open during a run). */
  autoScroll?: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!autoScroll || steps.length === 0) return;
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [autoScroll, steps]);

  if (steps.length === 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        When an agent run starts, tool calls and run milestones appear here in order. Open this panel
        before or during a task to watch the trace live.
      </p>
    );
  }

  return (
    <div className="max-h-[min(70vh,520px)] overflow-y-auto pr-1 -mr-1">
      <div className="space-y-1">
        {steps.map((step) => (
          <TraceStep key={step.id} step={step} />
        ))}
      </div>
      <div ref={bottomRef} className="h-px" aria-hidden />
    </div>
  );
}
