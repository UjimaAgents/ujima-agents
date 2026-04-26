"use client";

import { useChat } from "@ai-sdk/react";

export function StreamingTextPanel() {
  const { messages, input, handleInputChange, handleSubmit, status } = useChat({
    api: "/api/onboarding/chat",
  });

  return (
    <section className="flex h-full flex-col rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Streaming Text</h3>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">useChat (Vercel AI SDK)</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-lg border border-zinc-100 bg-zinc-50 p-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        {messages.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">Ask for onboarding guidance to see streaming responses.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="rounded-md bg-white p-2 shadow-sm dark:bg-zinc-900">
              <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{message.role}</p>
              <p className="mt-1 text-zinc-900 dark:text-zinc-100">{message.content}</p>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
        <input
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
          value={input}
          onChange={handleInputChange}
          placeholder="Explain recommended team setup..."
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          disabled={status === "streaming" || status === "submitted"}
        >
          Send
        </button>
      </form>
    </section>
  );
}
