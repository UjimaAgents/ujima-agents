"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Smile, Paperclip, Send, X } from "lucide-react";
import type { ChatMessageData } from "./chat-message";

export interface MentionSuggestion {
  id: string;
  name: string;
  detail?: string;
}

interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

function findMentionTrigger(value: string, caret: number): MentionTrigger | null {
  if (caret < 0) return null;
  const uptoCaret = value.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(uptoCaret);
  if (!match) return null;
  const full = match[0];
  const query = match[2] ?? "";
  const start = uptoCaret.length - full.length + (match[1]?.length ?? 0);
  return { start, end: caret, query };
}

export function ChatInput({
  placeholder = "Type a message...",
  onSend,
  statusHint,
  inlineError,
  mentionSuggestions = [],
  replyTo,
  onCancelReply,
}: {
  placeholder?: string;
  onSend: (content: string) => Promise<void> | void;
  statusHint?: string;
  inlineError?: string;
  mentionSuggestions?: MentionSuggestion[];
  replyTo?: ChatMessageData | null;
  onCancelReply?: () => void;
}) {
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [cursorPosition, setCursorPosition] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (replyTo) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [replyTo]);
  const canSend = content.trim().length > 0 && !isSending;
  const mentionTrigger = findMentionTrigger(content, cursorPosition);
  const filteredMentionSuggestions = useMemo(() => {
    if (!mentionTrigger) return [];
    const query = mentionTrigger.query.trim().toLowerCase();
    return mentionSuggestions.filter((suggestion) =>
      query
        ? suggestion.name.toLowerCase().includes(query)
        : true,
    );
  }, [mentionSuggestions, mentionTrigger]);
  const mentionMenuOpen =
    !!mentionTrigger && filteredMentionSuggestions.length > 0;

  const insertMention = (suggestion: MentionSuggestion) => {
    if (!mentionTrigger) return;
    const before = content.slice(0, mentionTrigger.start);
    const after = content.slice(mentionTrigger.end);
    const mentionValue = `@${suggestion.name} `;
    const next = `${before}${mentionValue}${after}`;
    const nextCaret = before.length + mentionValue.length;
    setContent(next);
    setCursorPosition(nextCaret);
    setActiveMentionIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const send = async () => {
    const next = content.trim();
    if (!next || isSending) return;

    setError(null);
    setIsSending(true);
    try {
      await onSend(next);
      setContent("");
      setCursorPosition(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="shrink-0 px-4 py-2 border-t border-zinc-200 dark:border-zinc-800">
      <div className="relative group">
        {inlineError ? (
          <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {inlineError}
          </p>
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/10 to-indigo-500/10 rounded-xl blur-lg opacity-0 group-focus-within:opacity-100 transition-opacity" />
        <div className="relative flex flex-col rounded-xl border border-zinc-200 bg-zinc-50 focus-within:border-violet-500 focus-within:bg-white focus-within:ring-1 focus-within:ring-violet-500 transition-all dark:border-zinc-800 dark:bg-zinc-900/50 dark:focus-within:bg-[#09090b]">
          {replyTo && (
            <div className="flex items-center gap-2 rounded-t-xl border-b border-zinc-200 bg-violet-50/50 px-3 py-1.5 dark:border-zinc-800 dark:bg-violet-500/5">
              <div className="flex-1 min-w-0">
                <p className="truncate text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                  Replying to {replyTo.name}
                </p>
                <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                  {replyTo.content}
                </p>
              </div>
              {onCancelReply && (
                <button
                  type="button"
                  onClick={onCancelReply}
                  className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-200/50 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            placeholder={placeholder}
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setCursorPosition(
                event.target.selectionStart ?? event.target.value.length,
              );
              setActiveMentionIndex(0);
            }}
            onSelect={(event) => {
              setCursorPosition(event.currentTarget.selectionStart ?? 0);
            }}
            onClick={(event) => {
              setCursorPosition(event.currentTarget.selectionStart ?? 0);
              setActiveMentionIndex(0);
            }}
            onKeyUp={(event) => {
              setCursorPosition(event.currentTarget.selectionStart ?? 0);
              setActiveMentionIndex(0);
            }}
            onKeyDown={(event) => {
              if (mentionMenuOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveMentionIndex((index) =>
                    (index + 1) % filteredMentionSuggestions.length,
                  );
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveMentionIndex((index) =>
                    (index - 1 + filteredMentionSuggestions.length) %
                    filteredMentionSuggestions.length,
                  );
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  event.preventDefault();
                  insertMention(
                    filteredMentionSuggestions[activeMentionIndex] ??
                      filteredMentionSuggestions[0],
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setActiveMentionIndex(0);
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            className="w-full bg-transparent px-3 py-2.5 text-xs focus:outline-none resize-none min-h-[56px]"
          />
          {mentionMenuOpen ? (
            <div className="mx-2 mt-1 max-h-44 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
              {filteredMentionSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.id}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertMention(suggestion);
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition ${
                    index === activeMentionIndex
                      ? "bg-violet-50 text-violet-800 dark:bg-violet-500/15 dark:text-violet-200"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  }`}
                >
                  <span className="font-semibold">@{suggestion.name}</span>
                  {suggestion.detail ? (
                    <span className="ml-2 truncate text-[10px] text-zinc-500 dark:text-zinc-400">
                      {suggestion.detail}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Add content" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <Plus className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Add reaction" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <Smile className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Attach file" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <Paperclip className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void send()}
              aria-label="Send message"
              className="flex items-center justify-center h-7 w-7 rounded-lg bg-violet-600 text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="mt-2 px-1 text-[10px] text-zinc-500 dark:text-zinc-400">
          <span className="block truncate">
            {statusHint ?? "Enter to send, Shift+Enter for a new line."}
          </span>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>
    </div>
  );
}
