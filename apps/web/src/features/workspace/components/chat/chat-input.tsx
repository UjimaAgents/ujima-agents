"use client";

import { useState } from "react";
import { Plus, Smile, Paperclip, Send } from "lucide-react";

export function ChatInput({
  placeholder = "Type a message...",
  onSend,
  statusHint,
}: {
  placeholder?: string;
  onSend: (content: string) => Promise<void> | void;
  statusHint?: string;
}) {
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSend = content.trim().length > 0 && !isSending;

  const send = async () => {
    const next = content.trim();
    if (!next || isSending) return;

    setError(null);
    setIsSending(true);
    try {
      await onSend(next);
      setContent("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="shrink-0 px-4 py-2 border-t border-zinc-200 dark:border-zinc-800">
      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/10 to-indigo-500/10 rounded-xl blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity" />
        <div className="relative flex flex-col rounded-xl border border-zinc-200 bg-zinc-50 focus-within:border-violet-500 focus-within:bg-white focus-within:ring-1 focus-within:ring-violet-500 transition-all dark:border-zinc-800 dark:bg-zinc-900/50 dark:focus-within:bg-[#09090b]">
          <textarea
            placeholder={placeholder}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            className="w-full bg-transparent px-3 py-2.5 text-xs focus:outline-none resize-none min-h-[56px]"
          />
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <Plus className="h-4 w-4" />
              </button>
              <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <Smile className="h-4 w-4" />
              </button>
              <button className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <Paperclip className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void send()}
              className="flex items-center justify-center h-7 w-7 rounded-lg bg-violet-600 text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          <span className="truncate">
            {statusHint ?? "Enter to send, Shift+Enter for a new line."}
          </span>
          <span className="shrink-0 font-medium uppercase tracking-[0.16em]">
            Live
          </span>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
