"use client";

import { MessageSquare } from "lucide-react";
import { useSearchParams } from "next/navigation";
import type { SelectedConversation } from "../types";

export function EmptyChat({
  conversation,
  loading,
}: {
  conversation: SelectedConversation;
  loading?: boolean;
}) {
  const searchParams = useSearchParams();
  const isAgent = conversation.type === "agent";
  const justOnboarded = searchParams.get("onboarding") === "complete";

  if (isAgent && justOnboarded && !loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-500/15">
          <MessageSquare className="h-7 w-7 text-violet-600 dark:text-violet-300" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-zinc-900 dark:text-white">
          Your workspace is ready
        </h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
          Send {conversation.name}: <span className="font-medium text-zinc-700 dark:text-zinc-200">&ldquo;Review this project and tell me the three most useful improvements to make first.&rdquo;</span>
        </p>
        <div className="mt-6 max-w-md rounded-xl bg-zinc-50 px-5 py-4 text-left dark:bg-zinc-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Next up</p>
          <ul className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
            <li>1. Complete your first task</li>
            <li>2. Review safety and approval settings</li>
            <li>3. Add another agent and try delegation</li>
            <li>4. Create channels when your team needs them</li>
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
        <MessageSquare className="h-7 w-7 text-zinc-400" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-white">
        {loading
          ? "Loading conversation…"
          : isAgent
            ? `Start a conversation with ${conversation.name}`
            : `Welcome to #${conversation.name}`}
      </h3>
      <p className="mt-1 text-xs text-zinc-500 max-w-xs text-center">
        {loading
          ? "Loading messages…"
          : isAgent
            ? "Send a message or assign a task to get started."
            : "Send a message to start the conversation."}
      </p>
    </div>
  );
}
