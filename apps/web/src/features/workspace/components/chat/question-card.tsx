import { memo } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { InteractiveQuestion } from "@ujima/shared/browser";
import { TERMINAL_PANEL } from "./terminal-chrome";

export interface QuestionCardProps {
  question: InteractiveQuestion;
  resolving?: boolean;
  error?: string;
  onAnswer?: (option: string) => void;
  // Pagination
  activeQuestionIndex?: number;
  totalQuestions?: number;
  onIndexChange?: (index: number) => void;
}

export const QuestionCard = memo(function QuestionCard({
  question,
  resolving,
  error,
  onAnswer,
  activeQuestionIndex = 0,
  totalQuestions = 1,
  onIndexChange,
}: QuestionCardProps) {
  const hasMultiple = totalQuestions > 1;

  return (
    <div
      key={question.id}
      className={`${TERMINAL_PANEL} animate-in fade-in-50 slide-in-from-bottom-1 duration-150`}
    >
      <div className="space-y-3 px-3 py-3">
        {hasMultiple && onIndexChange ? (
          <div className="flex items-center justify-end gap-1.5 font-mono text-[10px] leading-none text-foreground/55">
            <button
              type="button"
              disabled={activeQuestionIndex === 0 || resolving}
              onClick={() => onIndexChange(activeQuestionIndex - 1)}
              className="flex h-5 w-5 items-center justify-center rounded border border-violet-500/[0.08] text-foreground/55 transition hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-30 dark:border-white/10"
              aria-label="Previous question"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="translate-y-px">
              {activeQuestionIndex + 1}/{totalQuestions}
            </span>
            <button
              type="button"
              disabled={activeQuestionIndex === totalQuestions - 1 || resolving}
              onClick={() => onIndexChange(activeQuestionIndex + 1)}
              className="flex h-5 w-5 items-center justify-center rounded border border-violet-500/[0.08] text-foreground/55 transition hover:bg-foreground/[0.04] hover:text-foreground disabled:opacity-30 dark:border-white/10"
              aria-label="Next question"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        <div className="font-mono text-[11px] leading-relaxed text-foreground/85">
          {question.questionText}
        </div>

        <div className="space-y-1.5">
          {question.options.map((opt, index) => (
            <button
              key={`${question.id}:${index}:${opt}`}
              type="button"
              disabled={resolving}
              onClick={() => onAnswer?.(opt)}
              className="group flex w-full items-start gap-2 rounded-md border border-violet-500/[0.06] px-2.5 py-2 text-left font-mono text-[11px] leading-relaxed text-foreground/80 transition hover:border-violet-500/20 hover:bg-foreground/[0.035] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.04]"
            >
              <span className="shrink-0 select-none text-foreground/40">
                {resolving ? (
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  `${index + 1}.`
                )}
              </span>
              <span className="min-w-0 break-words">{opt}</span>
            </button>
          ))}
        </div>

        {error ? (
          <p className="font-mono text-[11px] leading-relaxed text-red-700 dark:text-red-300/90">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
});
