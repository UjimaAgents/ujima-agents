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
      <p className="text-xs text-foreground/50">No trace steps.</p>
    );
  }

  return (
    <div className="space-y-0">
      {steps.map((step, index) => (
        <TraceStep
          key={step.id}
          step={step}
          isLast={index === steps.length - 1}
        />
      ))}
      <div ref={bottomRef} className="h-px w-full shrink-0" aria-hidden />
    </div>
  );
}
