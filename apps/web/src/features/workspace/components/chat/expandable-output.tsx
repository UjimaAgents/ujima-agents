"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

const TRUNCATED_HEIGHT = 280;

export function ExpandableOutput({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      setNeedsTruncation(el.scrollHeight > TRUNCATED_HEIGHT + 4);
    }
  });

  return (
    <div className={`relative min-w-0 max-w-full ${className}`}>
      <div
        ref={contentRef}
        className={isExpanded ? "overflow-x-auto" : "overflow-hidden"}
        style={!isExpanded ? { maxHeight: TRUNCATED_HEIGHT } : undefined}
      >
        {children}
      </div>
      {!isExpanded && needsTruncation ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-50 via-zinc-50/70 to-transparent dark:from-zinc-900 dark:via-zinc-900/70" />
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center">
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-zinc-950/90 px-3 py-1 text-[10px] font-semibold text-white shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-400/70 dark:border-white/10 dark:bg-zinc-950/90 dark:text-white"
            >
              Show more
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </>
      ) : null}
      {isExpanded ? (
        <div className="flex justify-center pt-1.5 pb-0.5">
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-zinc-950/90 px-3 py-1 text-[10px] font-semibold text-white shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-400/70 dark:border-white/10 dark:bg-zinc-950/90 dark:text-white"
          >
            Show less
            <ChevronUp className="h-3 w-3" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
