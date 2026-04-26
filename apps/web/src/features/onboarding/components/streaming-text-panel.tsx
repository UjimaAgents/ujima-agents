"use client";

import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

// `useChat` in @ai-sdk/react@3 (paired with ai@6) no longer returns
// `input`, `handleInputChange`, or `handleSubmit`. The caller now owns
// input state and calls `sendMessage({ text })`. Transport is built
// explicitly via `DefaultChatTransport({ api })` instead of the legacy
// `useChat({ api })` shorthand.
export function StreamingTextPanel() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/onboarding/chat" }),
  });

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    void sendMessage({ text: trimmed });
    setInput("");
  };

  // v6 messages carry `parts: [{ type: 'text', text }]` — flatten to a
  // string for display.
  const renderMessage = (parts: unknown): string => {
    if (!Array.isArray(parts)) return "";
    return parts
      .filter(
        (part): part is { type: "text"; text: string } =>
          typeof part === "object" &&
          part !== null &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
      )
      .map((part) => part.text)
      .join("");
  };

  const busy = status === "streaming" || status === "submitted";

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
              <p className="mt-1 text-zinc-900 dark:text-zinc-100">{renderMessage(message.parts)}</p>
            </div>
          ))
        )}
      </div>
      <form onSubmit={onSubmit} className="mt-2 flex gap-2">
        <input
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 dark:border-zinc-700 dark:bg-zinc-950"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Explain recommended team setup..."
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          disabled={busy}
        >
          Send
        </button>
      </form>
    </section>
  );
}
