"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  Paperclip,
  Plus,
  Send,
  Smile,
  Square,
  X,
} from "lucide-react";
import { AttachmentSchema, type AttachmentCategory } from "@ujima/shared";
import type { ChatMessageData } from "./chat-message";
import { MarkdownInline } from "../markdown";

export interface MentionSuggestion {
  id: string;
  name: string;
  detail?: string;
}

interface UploadedAttachment {
  id: string;
  filename: string;
  mimeType: string;
  category: AttachmentCategory;
  sizeBytes: number;
  previewUrl?: string;
  uploading?: boolean;
}

interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

type ComposerCommand = "summarize" | "clear";

const SLASH_COMMANDS: Array<{
  command: ComposerCommand;
  label: string;
  description: string;
}> = [
  {
    command: "summarize",
    label: "/summarize",
    description: "Compact the thread and keep the recent raw window.",
  },
  {
    command: "clear",
    label: "/clear",
    description: "Archive the thread and empty the visible chat.",
  },
];

export function getExactSlashCommand(value: string): ComposerCommand | null {
  const trimmed = value.trim();
  if (trimmed === "/summarize") return "summarize";
  if (trimmed === "/clear") return "clear";
  return null;
}

export function getSlashQuery(value: string): string | null {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("/")) return null;
  const token = trimmed.split(/\s/, 1)[0] ?? "";
  if (token.length !== trimmed.length) return null;
  if (token.length <= 1) return "";
  return token.slice(1).toLowerCase();
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
  onCommand,
  statusHint,
  inlineError,
  mentionSuggestions = [],
  replyTo,
  onCancelReply,
  organizationId,
  stoppableRunId,
  onStopRun,
}: {
  placeholder?: string;
  organizationId?: string;
  onSend: (content: string, attachmentIds?: string[]) => Promise<void> | void;
  onCommand: (command: ComposerCommand) => Promise<void> | void;
  statusHint?: string;
  inlineError?: string;
  mentionSuggestions?: MentionSuggestion[];
  replyTo?: ChatMessageData | null;
  onCancelReply?: () => void;
  /** When set and the composer has no draft, show Stop instead of Send. */
  stoppableRunId?: string | null;
  onStopRun?: (runId: string) => Promise<void> | void;
}) {
  const [content, setContent] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isCommanding, setIsCommanding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [clearConfirmation, setClearConfirmation] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [emojiMenuOpen, setEmojiMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiMenuRef = useRef<HTMLDivElement>(null);
  const emojiToggleRef = useRef<HTMLButtonElement>(null);
  const attachmentsRef = useRef<UploadedAttachment[]>([]);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const emojiOptions = [
    "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂",
    "🙂", "🙃", "😉", "😊", "😍", "😘", "😎", "🤩",
    "🤔", "😴", "😭", "😡", "🤯", "🥳", "😇", "🤗",
    "👍", "👎", "👏", "🙌", "🤝", "🙏", "💪", "🤞",
    "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
    "🔥", "✨", "💥", "💫", "💡", "✅", "❌", "⚡",
    "🎉", "🎊", "🥂", "🍾", "🎯", "🚀", "🧠", "📌",
    "📎", "📝", "💬", "📣", "👀", "👋", "🌟", "☕",
  ];

  function revokePreviewUrl(attachment: UploadedAttachment) {
    if (attachment.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }

  useEffect(() => {
    if (replyTo) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [replyTo]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    if (!emojiMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (emojiMenuRef.current?.contains(target)) return;
      if (emojiToggleRef.current?.contains(target)) return;
      setEmojiMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEmojiMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [emojiMenuOpen]);
  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        revokePreviewUrl(attachment);
      }
    };
  }, []);
  const hasAttachments = attachments.length > 0;
  const hasDraft = content.trim().length > 0 || hasAttachments;
  const exactSlashCommand = hasAttachments ? null : getExactSlashCommand(content);
  const canConfirmClear = clearConfirmation && exactSlashCommand === "clear";
  const slashQuery = canConfirmClear || hasAttachments ? null : getSlashQuery(content);
  const slashMenuOptions = useMemo(() => {
    if (slashQuery === null) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((option) => option.command.startsWith(slashQuery));
  }, [slashQuery]);
  const slashMenuOpen = slashQuery !== null && slashMenuOptions.length > 0;
  const showStopInsteadOfSend =
    Boolean(stoppableRunId && onStopRun) &&
    content.trim().length === 0 &&
    attachments.length === 0 &&
    !uploading &&
    !isSending &&
    !isCommanding;
  const mentionTrigger = findMentionTrigger(content, selection.start);
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
  const activeSlashSelection = Math.min(
    activeSlashIndex,
    Math.max(slashMenuOptions.length - 1, 0),
  );

  const thumbnailUrl = (attachmentId: string) =>
    `/api/attachments/${encodeURIComponent(attachmentId)}/thumbnail?organizationId=${encodeURIComponent(organizationId ?? "")}`;

  const updateAttachment = (attachmentId: string, updater: (attachment: UploadedAttachment) => UploadedAttachment) => {
    setAttachments((current) => current.map((attachment) => (attachment.id === attachmentId ? updater(attachment) : attachment)));
  };

  const cancelAttachmentUpload = (attachmentId: string) => {
    uploadControllersRef.current.get(attachmentId)?.abort();
    uploadControllersRef.current.delete(attachmentId);
  };

  const removeAttachment = (attachmentId: string) => {
    cancelAttachmentUpload(attachmentId);
    setAttachments((current) => {
      const attachment = current.find((item) => item.id === attachmentId);
      if (attachment) revokePreviewUrl(attachment);
      return current.filter((item) => item.id !== attachmentId);
    });
  };

  const uploadOne = async (file: globalThis.File, organizationIdValue: string): Promise<void> => {
    const tempId = crypto.randomUUID();
    const controller = new AbortController();
    uploadControllersRef.current.set(tempId, controller);
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
    const tempAttachment: UploadedAttachment = {
      id: tempId,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      category: categorizeAttachment(file.type),
      sizeBytes: file.size,
      previewUrl,
      uploading: true,
    };
    setAttachments((current) => [...current, tempAttachment]);

    try {
      const form = new FormData();
      form.set("organizationId", organizationIdValue);
      form.set("file", file);
      const response = await fetch("/api/attachments", {
        method: "POST",
        signal: controller.signal,
        body: form,
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          body &&
            typeof body === "object" &&
            "message" in body &&
            typeof body.message === "string"
            ? body.message
            : "Unable to upload attachment.",
        );
      }
      const parsed = AttachmentSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error("Unexpected attachment response.");
      }
      const attachment = parsed.data;
      updateAttachment(tempId, (current) => {
        if (current.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(current.previewUrl);
        }
        return {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          category: attachment.category,
          sizeBytes: attachment.sizeBytes,
          previewUrl:
            attachment.category === "image" ? thumbnailUrl(attachment.id) : undefined,
          uploading: false,
        };
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      revokePreviewUrl(tempAttachment);
      removeAttachment(tempId);
      throw err;
    } finally {
      uploadControllersRef.current.delete(tempId);
    }
  };

  const uploadFiles = async (files: globalThis.File[]) => {
    if (!organizationId) {
      setError("Missing organization context for attachments.");
      return;
    }
    if (files.length === 0) return;

    setError(null);
    setUploading(true);
    setUploadProgress(0);
    let processed = 0;

    try {
      for (const file of files) {
        try {
          await uploadOne(file, organizationId);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            break;
          }
          setError(err instanceof Error ? err.message : "Unable to upload attachment.");
          break;
        } finally {
          processed += 1;
          setUploadProgress(Math.round((processed / files.length) * 100));
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const handleFiles = (files: globalThis.File[]) => {
    if (uploading) return;
    void uploadFiles(files);
  };

  const handleAttachmentInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    handleFiles(files);
  };

  const handleDrag = (next: boolean) => {
    setIsDragging(next);
  };

  function categorizeAttachment(mimeType: string): AttachmentCategory {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("video/")) return "video";
    if (
      mimeType.startsWith("text/") ||
      mimeType === "application/pdf" ||
      mimeType === "application/json" ||
      mimeType === "application/xml"
    ) {
      return "document";
    }
    if (
      mimeType === "application/zip" ||
      mimeType === "application/gzip" ||
      mimeType === "application/x-7z-compressed"
    ) {
      return "archive";
    }
    return "other";
  }

  function formatAttachmentSize(sizeBytes: number): string {
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 102.4) / 10} KB`;
    return `${Math.round(sizeBytes / 104857.6) / 10} MB`;
  }

  function getAttachmentIcon(category: AttachmentCategory) {
    if (category === "image") return FileImage;
    if (category === "document") return FileText;
    if (category === "audio") return FileAudio;
    if (category === "video") return FileVideo;
    if (category === "archive") return FileArchive;
    return FileIcon;
  }

  const insertMention = (suggestion: MentionSuggestion) => {
    if (!mentionTrigger) return;
    const before = content.slice(0, mentionTrigger.start);
    const after = content.slice(mentionTrigger.end);
    const mentionValue = `@${suggestion.name} `;
    const next = `${before}${mentionValue}${after}`;
    const nextCaret = before.length + mentionValue.length;
    setContent(next);
    setSelection({ start: nextCaret, end: nextCaret });
    setActiveMentionIndex(0);
    setEmojiMenuOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const insertEmoji = (emoji: string) => {
    const before = content.slice(0, selection.start);
    const after = content.slice(selection.end);
    const next = `${before}${emoji}${after}`;
    const nextCaret = before.length + emoji.length;
    setContent(next);
    setSelection({ start: nextCaret, end: nextCaret });
    setEmojiMenuOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const send = async () => {
    const next = content.trim();
    if (isSending || uploading || (next.length === 0 && attachments.length === 0)) return;

    setError(null);
    setIsSending(true);
    try {
      await onSend(next, attachments.map((attachment) => attachment.id));
      for (const attachment of attachments) {
        revokePreviewUrl(attachment);
      }
      setContent("");
      setSelection({ start: 0, end: 0 });
      setEmojiMenuOpen(false);
      setAttachments([]);
      setUploadProgress(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  };

  const runSlashCommand = async (command: ComposerCommand) => {
    if (isSending || isCommanding || uploading) return;
    if (command === "clear" && !canConfirmClear) {
      setClearConfirmation(true);
      setError(null);
      setContent("/clear");
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(6, 6);
      });
      return;
    }

    setError(null);
    setIsCommanding(true);
    try {
      await onCommand(command);
      setContent("");
      setSelection({ start: 0, end: 0 });
      setAttachments([]);
      setUploadProgress(0);
      setClearConfirmation(false);
      setEmojiMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run command.");
    } finally {
      setIsCommanding(false);
    }
  };

  const confirmClear = async () => {
    await runSlashCommand("clear");
  };

  const submitComposer = async () => {
    if (showStopInsteadOfSend) {
      await stopRun();
      return;
    }
    if (canConfirmClear) {
      await confirmClear();
      return;
    }
    if (exactSlashCommand) {
      await runSlashCommand(exactSlashCommand);
      return;
    }
    await send();
  };

  const stopRun = async () => {
    if (!stoppableRunId || !onStopRun || isStopping) return;
    setError(null);
    setIsStopping(true);
    try {
      await onStopRun(stoppableRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to stop the run.");
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div className="shrink-0 px-4 py-2 border-t border-zinc-200 dark:border-zinc-800">
      <div
        className={`relative group ${isDragging ? "ring-2 ring-violet-400/50 ring-offset-2 ring-offset-transparent" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          handleDrag(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          handleDrag(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          handleDrag(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          handleDrag(false);
          handleFiles(Array.from(event.dataTransfer.files ?? []));
        }}
      >
        {inlineError ? (
          <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            {inlineError}
          </p>
        ) : null}
        {canConfirmClear ? (
          <div className="relative z-10 mb-2 rounded-xl border border-red-200 bg-red-50/90 px-4 py-3 shadow-sm backdrop-blur dark:border-red-500/30 dark:bg-red-500/10">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-red-800 dark:text-red-200">
                  Archive and clear this conversation?
                </p>
                <p className="mt-0.5 text-[10px] leading-4 text-red-700/80 dark:text-red-200/80">
                  This keeps a compact archive and empties the visible thread.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setClearConfirmation(false);
                    setContent("");
                    setError(null);
                  }}
                  className="rounded-md border border-red-200 bg-white px-2 py-1 text-[10px] font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-500/30 dark:bg-zinc-950 dark:text-red-200 dark:hover:bg-red-500/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    void confirmClear();
                  }}
                  className="rounded-md bg-red-600 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-red-700"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleAttachmentInput}
        />
        <div className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-violet-500/10 to-indigo-500/10 blur-lg opacity-0 transition-opacity group-focus-within:opacity-100" />
        <div className="relative z-10 flex flex-col rounded-xl border border-zinc-200 bg-zinc-50 transition-all focus-within:border-violet-500 focus-within:bg-white focus-within:ring-1 focus-within:ring-violet-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:focus-within:bg-[#09090b]">
          {replyTo && (
            <div className="flex items-center gap-2 rounded-t-xl border-b border-zinc-200 bg-violet-50/50 px-3 py-1.5 dark:border-zinc-800 dark:bg-violet-500/5">
              <div className="flex-1 min-w-0">
                <p className="truncate text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                  Replying to {replyTo.name}
                </p>
                <MarkdownInline
                  content={replyTo.content}
                  className="block truncate text-[10px] text-zinc-500 dark:text-zinc-400"
                />
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
              setSelection({
                start: event.target.selectionStart ?? event.target.value.length,
                end: event.target.selectionEnd ?? event.target.value.length,
              });
              setActiveMentionIndex(0);
            }}
            onSelect={(event) => {
              setSelection({
                start: event.currentTarget.selectionStart ?? 0,
                end: event.currentTarget.selectionEnd ?? 0,
              });
            }}
            onClick={(event) => {
              setSelection({
                start: event.currentTarget.selectionStart ?? 0,
                end: event.currentTarget.selectionEnd ?? 0,
              });
              setActiveMentionIndex(0);
            }}
            onKeyUp={(event) => {
              setSelection({
                start: event.currentTarget.selectionStart ?? 0,
                end: event.currentTarget.selectionEnd ?? 0,
              });
              setActiveMentionIndex(0);
            }}
            onKeyDown={(event) => {
              if (canConfirmClear) {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setClearConfirmation(false);
                  setContent("");
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void confirmClear();
                  return;
                }
              }
              if (exactSlashCommand && event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void runSlashCommand(exactSlashCommand);
                return;
              }
              if (slashMenuOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveSlashIndex((index) =>
                    (index + 1) % slashMenuOptions.length,
                  );
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveSlashIndex((index) =>
                    (index - 1 + slashMenuOptions.length) % slashMenuOptions.length,
                  );
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const selected = slashMenuOptions[activeSlashSelection] ?? slashMenuOptions[0];
                  if (selected) {
                    void runSlashCommand(selected.command);
                  }
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setContent("");
                  return;
                }
              }
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
                void submitComposer();
              }
            }}
            className="w-full bg-transparent px-3 py-2.5 text-sm focus:outline-none resize-none min-h-[56px]"
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
          {slashMenuOpen ? (
            <div className="mx-2 mt-1 overflow-hidden rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
              <div className="space-y-1">
                {slashMenuOptions.map((option, index) => (
                  <button
                    key={option.command}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      void runSlashCommand(option.command);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-xs transition ${
                      index === activeSlashSelection
                        ? "bg-violet-50 text-violet-900 dark:bg-violet-500/15 dark:text-violet-100"
                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    }`}
                  >
                    <span className="mt-0.5 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
                      {option.label}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">
                        {option.description}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div
            ref={emojiMenuRef}
            className={`absolute bottom-[68px] left-3 z-20 w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl transition ${emojiMenuOpen ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-1"} dark:border-zinc-700 dark:bg-zinc-950`}
          >
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                Emoji
              </p>
              <button
                type="button"
                onClick={() => setEmojiMenuOpen(false)}
                className="rounded-md px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Close
              </button>
            </div>
            <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto pr-1">
              {emojiOptions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertEmoji(emoji);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-lg transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          {attachments.length > 0 ? (
            <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {attachments.map((attachment) => {
                  const Icon = getAttachmentIcon(attachment.category);
                  return (
                    <div
                      key={attachment.id}
                      className={`relative shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50 ${
                        attachment.category === "image" ? "h-24 w-24" : "w-56"
                      } ${attachment.uploading ? "opacity-80" : ""}`}
                    >
                      {attachment.category === "image" ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element -- blob or cookie-backed API URL */}
                          <img
                          src={attachment.previewUrl ?? thumbnailUrl(attachment.id)}
                          alt={attachment.filename}
                          className="h-full w-full object-cover"
                        />
                        </>
                      ) : (
                        <div className="flex h-full items-center gap-3 px-3 py-2">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-300">
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                              {attachment.filename}
                            </p>
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                              {formatAttachmentSize(attachment.sizeBytes)}
                            </p>
                          </div>
                        </div>
                      )}
                      {attachment.uploading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white backdrop-blur transition hover:bg-black/80"
                        aria-label={`Remove ${attachment.filename}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
              {uploading ? (
                <div className="mt-2">
                  <div className="mb-1 flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Uploading attachments...
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-violet-600 transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center justify-between border-t border-zinc-200 px-3 py-1.5 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Add content" className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Add emoji"
                ref={emojiToggleRef}
                onClick={() => setEmojiMenuOpen((value) => !value)}
                className={`text-zinc-400 transition hover:text-zinc-600 dark:hover:text-zinc-300 ${emojiMenuOpen ? "text-violet-600 dark:text-violet-300" : ""}`}
              >
                <Smile className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Attach file"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-zinc-400 hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-zinc-300"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              disabled={
                showStopInsteadOfSend
                  ? isStopping
                  : isSending || isCommanding || uploading || (!hasDraft && !exactSlashCommand && !canConfirmClear)
              }
              onClick={() => void submitComposer()}
              aria-label={
                showStopInsteadOfSend
                  ? "Stop agent run"
                  : canConfirmClear
                    ? "Confirm clear conversation"
                    : exactSlashCommand === "clear"
                      ? "Clear conversation"
                      : exactSlashCommand === "summarize"
                        ? "Run summarize"
                        : "Send message"
              }
              className={
                showStopInsteadOfSend
                  ? "flex items-center justify-center h-7 w-7 rounded-lg bg-red-600 text-white shadow-lg shadow-red-500/20 hover:bg-red-700 transition disabled:cursor-not-allowed disabled:opacity-50"
                  : "flex items-center justify-center h-7 w-7 rounded-lg bg-violet-600 text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {showStopInsteadOfSend ? (
                isStopping ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Square className="h-3 w-3 fill-current" />
                )
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
        <div className="mt-2 px-1 text-xs text-zinc-500 dark:text-zinc-400">
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
