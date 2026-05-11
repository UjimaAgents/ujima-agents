import { MessageSquare } from "lucide-react";
import type { SelectedConversation } from "../types";

export function EmptyChat({
  conversation,
  loading,
}: {
  conversation: SelectedConversation;
  loading?: boolean;
}) {
  const isAgent = conversation.type === "agent";
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
          ? "Pulling the latest thread history and live updates."
          : isAgent
            ? "Send a message or assign a task to get started."
            : "This is the beginning of the channel. Send a message to start collaborating."}
      </p>
    </div>
  );
}
