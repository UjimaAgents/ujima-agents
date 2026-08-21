"use client";

import { useEffect, useState } from "react";
import type { InteractiveQuestion } from "@ujima/shared/browser";
import { clientFetchJson } from "@/lib/client-api";

interface UseThreadQuestionsInput {
  currentThreadId?: string;
  organizationId?: string;
  waitingInputRunIds: string[];
  refreshSignal: string;
}

/**
 * Fan-out fetch of interactive questions for the open thread plus every
 * waiting-for-input run, deduped by question id.
 */
export function useThreadQuestions({
  currentThreadId,
  organizationId,
  waitingInputRunIds,
  refreshSignal,
}: UseThreadQuestionsInput) {
  const [pendingQuestions, setPendingQuestions] = useState<InteractiveQuestion[]>([]);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!organizationId || !currentThreadId) {
      queueMicrotask(() => {
        if (cancelled) return;
        setPendingQuestions([]);
        setActiveQuestionIndex(0);
      });
      return;
    }
    void (async () => {
      const loadQuestions = (url: string) =>
        clientFetchJson<{ questions?: InteractiveQuestion[] }>(url, {}, "Unable to load questions.")
          .then((body) => body.questions ?? [])
          .catch(() => []);
      const byThread = loadQuestions(`/api/questions?threadId=${encodeURIComponent(currentThreadId)}`);
      const pages = await Promise.all(
        [
          byThread,
          ...waitingInputRunIds.map((runId) =>
            loadQuestions(`/api/questions?runId=${encodeURIComponent(runId)}`),
          ),
        ],
      );
      if (cancelled) return;
      const next = Array.from(new Map(pages.flat().map((question) => [question.id, question])).values());
      setPendingQuestions(next);
      setActiveQuestionIndex((index) => Math.min(index, Math.max(next.length - 1, 0)));
    })();
    return () => {
      cancelled = true;
    };
  }, [currentThreadId, organizationId, refreshSignal, waitingInputRunIds]);

  return {
    pendingQuestions,
    activeQuestionIndex,
    setActiveQuestionIndex,
    removeQuestion: (questionId: string) =>
      setPendingQuestions((state) => {
        const next = state.filter((question) => question.id !== questionId);
        setActiveQuestionIndex((index) => Math.min(index, Math.max(next.length - 1, 0)));
        return next;
      }),
  };
}
