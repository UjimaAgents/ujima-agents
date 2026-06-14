"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Send,
  Square,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { AttachmentSchema, type AttachmentCategory } from "@ujima/shared/browser";
import {
  clampReasoningEffortForProvider,
  getReasoningEffortsForProvider,
  type ReasoningEffort,
} from "@ujima/shared/browser";
import { Select } from "@/components/ui/select";
import { RunningFigureIndicator } from "./primitives";
import {
  listItemIdle,
  listItemSelected,
  listItemSubtitleIdle,
  listItemSubtitleSelected,
} from "@/lib/list-item-styles";
import type { ChatMessageData } from "./chat-message";
import { MarkdownInline } from "../markdown";
import { useComposerVoiceInput } from "./use-composer-voice-input";
import { VoiceInputWaves } from "./voice-input-waves";

export interface MentionSuggestion {
  id: string;
  name: string;
  detail?: string;
  kind?: 'member' | 'file' | 'folder';
  path?: string;
}

export interface SlashSkillCommand {
  id: string;
  command: string;
  label: string;
  description: string;
}

export function toSlashSkillCommands(
  skills: readonly {
    id: string;
    commandName: string;
    description: string;
    userInvocable: boolean;
  }[],
): SlashSkillCommand[] {
  return skills
    .filter((skill) => skill.userInvocable)
    .map((skill) => ({
      id: skill.id,
      command: skill.commandName,
      label: `/${skill.commandName}`,
      description: skill.description,
    }));
}

type SlashMenuOption =
  | ({ kind: "builtin" } & (typeof BUILTIN_SLASH_COMMANDS)[number])
  | ({ kind: "skill" } & SlashSkillCommand);

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

export type ComposerCommand = "summarize" | "clear" | "goal" | "schedule";
type ThreadCommand = Exclude<ComposerCommand, "goal">;

const BUILTIN_SLASH_COMMANDS: Array<{
  command: ComposerCommand;
  label: string;
  description: string;
}> = [
  {
    command: "clear",
    label: "/clear",
    description: "Archive the thread and empty the visible chat.",
  },
  {
    command: "goal",
    label: "/goal",
    description: "Toggle goal mode for this conversation.",
  },
  {
    command: "schedule",
    label: "/schedule do this",
    description: "Ask the agent to schedule a follow-up.",
  },
  {
    command: "summarize",
    label: "/summarize",
    description: "Compact the thread and keep the recent raw window.",
  },
];

const MAX_COMPOSER_ROWS = 3;
const SLASH_MENU_PREVIEW_COUNT = 5;
function reasoningLabel(value: ReasoningEffort): string {
  return value === "extra_high" ? "Extra High" : value.charAt(0).toUpperCase() + value.slice(1);
}

export function getExactSlashCommand(value: string): ComposerCommand | null {
  const trimmed = value.trim();
  if (trimmed === "/summarize") return "summarize";
  if (trimmed === "/clear") return "clear";
  if (trimmed === "/goal") return "goal";
  if (trimmed.startsWith("/schedule ")) return "schedule";
  if (trimmed === "/schedule") return "schedule";
  return null;
}

function getExactSlashCommandDefinition(value: string, commands: SlashMenuOption[]) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  const token = trimmed.split(/\s/, 1)[0] ?? "";
  if (token.length <= 1) return null;
  const command = token.slice(1).toLowerCase();
  return commands.find((option) => option.command === command) ?? null;
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

function assetSearchQuery(raw: string): string {
  return raw.trim().replace(/^(file|folder):/i, "").trim();
}

function assetKindHint(raw: string): "file" | "folder" | null {
  if (/^folder:/i.test(raw)) return "folder";
  if (/^file:/i.test(raw)) return "file";
  return null;
}

type WorkspaceAssetHit = { kind: "file" | "folder"; name: string; path: string };

function toAssetSuggestion(entry: WorkspaceAssetHit): MentionSuggestion {
  return {
    id: `${entry.kind}:${entry.path}`,
    name: entry.name,
    kind: entry.kind,
    path: entry.path,
    detail: entry.path,
  };
}

const ROOT_FOLDERS_TTL_MS = 60_000;
let cachedRootFolders: { at: number; items: MentionSuggestion[] } | null = null;

async function loadWorkspaceAssetSuggestions(searchQuery: string): Promise<MentionSuggestion[]> {
  const url = searchQuery
    ? `/api/workspaces/search?q=${encodeURIComponent(searchQuery)}`
    : "/api/workspaces/search";
  if (!searchQuery) {
    const now = Date.now();
    if (cachedRootFolders && now - cachedRootFolders.at < ROOT_FOLDERS_TTL_MS) {
      return cachedRootFolders.items;
    }
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) return [];
    const results = (await res.json()) as WorkspaceAssetHit[];
    const items = results.map(toAssetSuggestion);
    cachedRootFolders = { at: now, items };
    return items;
  }
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return [];
  const results = (await res.json()) as WorkspaceAssetHit[];
  return results.map(toAssetSuggestion);
}

function ChatInputComponent({
  placeholder = "Message here or type / for commands",
  onSend,
  onCommand,
  inlineError,
  mentionSuggestions = [],
  replyTo,
  onCancelReply,
  organizationId,
  goalMode: goalModeProp,
  onGoalModeChange,
  stoppableRunIds,
  onStopRun,
  readOnly = false,
  skillCommands = [],
  onSkillCommand,
  reasoningProvider,
  reasoningModelValue,
}: {
  placeholder?: string;
  organizationId?: string;
  onSend: (content: string, attachmentIds?: string[], metadata?: { goalMode?: boolean; reasoningEffort?: ReasoningEffort }) => Promise<void> | void;
  onCommand: (command: ThreadCommand, rawContent?: string, metadata?: { goalMode?: boolean; reasoningEffort?: ReasoningEffort }) => Promise<void> | void;
  inlineError?: string;
  mentionSuggestions?: MentionSuggestion[];
  replyTo?: ChatMessageData | null;
  onCancelReply?: () => void;
  goalMode?: boolean;
  onGoalModeChange?: (active: boolean) => void;
  stoppableRunIds?: string[];
  onStopRun?: (runId: string) => Promise<void> | void;
  readOnly?: boolean;
  skillCommands?: SlashSkillCommand[];
  onSkillCommand?: (skillId: string, rawContent?: string, metadata?: { goalMode?: boolean; reasoningEffort?: ReasoningEffort }) => Promise<void> | void;
  reasoningProvider?: string;
  reasoningModelValue?: string;
}) {
  const goalMode = goalModeProp ?? false;
  const [content, setContent] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("none");
  const [isSending, setIsSending] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isCommanding, setIsCommanding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [slashMenuExpanded, setSlashMenuExpanded] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef(content);
  const attachmentsRef = useRef<UploadedAttachment[]>([]);
  const uploadControllersRef = useRef(new Map<string, AbortController>());
  const composerPlaceholder = readOnly ? `Observer Mode · ${placeholder}` : placeholder;
  const reasoningOptions = useMemo(
    () =>
      getReasoningEffortsForProvider(reasoningProvider ?? "", reasoningModelValue).map((value) => ({
        value,
        label: reasoningLabel(value),
      })),
    [reasoningModelValue, reasoningProvider],
  );
  const selectedReasoningEffort = clampReasoningEffortForProvider(
    reasoningProvider ?? "",
    reasoningEffort,
    reasoningModelValue,
  );
  const showReasoningSelect = reasoningOptions.length > 1;
  const reasoningDisabled = readOnly;

  const getDraft = useCallback(() => contentRef.current, []);
  const voice = useComposerVoiceInput({
    enabled: !readOnly && !uploading,
    getDraft,
    onTranscript: setContent,
    onError: (message) => setError(message),
  });
  const stopVoiceListening = voice.stopListening;

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (readOnly || uploading) stopVoiceListening();
  }, [readOnly, uploading, stopVoiceListening]);

  function revokePreviewUrl(attachment: UploadedAttachment) {
    if (attachment.previewUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }

  useEffect(() => {
    if (replyTo && !readOnly) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [readOnly, replyTo]);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const maxHeight = lineHeight * MAX_COMPOSER_ROWS;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [content]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        revokePreviewUrl(attachment);
      }
    };
  }, []);
  const hasAttachments = attachments.length > 0;
  const visibleAttachments = readOnly ? [] : attachments;
  const hasDraft = !readOnly && (content.trim().length > 0 || visibleAttachments.length > 0);
  const allSlashCommands = useMemo(
    () => [
      ...BUILTIN_SLASH_COMMANDS.map((option) => ({ ...option, kind: "builtin" as const })),
      ...skillCommands.map((option) => ({ ...option, kind: "skill" as const })),
    ],
    [skillCommands],
  );
  const exactSlashCommand = readOnly || hasAttachments ? null : getExactSlashCommandDefinition(content, allSlashCommands);
  const slashQuery = readOnly || hasAttachments ? null : getSlashQuery(content);
  const slashMenuOptions = useMemo(() => {
    if (slashQuery === null) return allSlashCommands;
    return allSlashCommands.filter((option) => option.command.startsWith(slashQuery));
  }, [allSlashCommands, slashQuery]);
  const slashMenuOpen = slashQuery !== null && slashMenuOptions.length > 0;
  const isSlashBrowseMode = slashQuery === "";
  const displayedSlashOptions = useMemo(() => {
    if (!isSlashBrowseMode || slashMenuExpanded) return slashMenuOptions;
    return slashMenuOptions.slice(0, SLASH_MENU_PREVIEW_COUNT);
  }, [isSlashBrowseMode, slashMenuExpanded, slashMenuOptions]);
  const hasMoreSlashCommands =
    isSlashBrowseMode &&
    !slashMenuExpanded &&
    slashMenuOptions.length > SLASH_MENU_PREVIEW_COUNT;
  const hiddenSlashCount = slashMenuOptions.length - SLASH_MENU_PREVIEW_COUNT;

  const [prevSlashQuery, setPrevSlashQuery] = useState<string | null>(slashQuery);
  if (slashQuery !== prevSlashQuery) {
    setPrevSlashQuery(slashQuery);
    setSlashMenuExpanded(false);
    setActiveSlashIndex(0);
  }

  const working = isSending || isCommanding || uploading;
  const canStopRun = Boolean(stoppableRunIds?.length && onStopRun);
  const stopRunLabel = stoppableRunIds?.length && stoppableRunIds.length > 1 ? "Stop runs" : "Stop run";
  const showStopInsteadOfSend =
    canStopRun &&
    !hasDraft &&
    !uploading &&
    !isSending &&
    !isCommanding &&
    !voice.isListening;
  const canSend =
    !readOnly &&
    (content.trim().length > 0 || visibleAttachments.length > 0 || Boolean(exactSlashCommand));
  const showVoiceInsteadOfSend =
    !readOnly && voice.support.supported && !canSend && !voice.isListening;
  const mentionTrigger = findMentionTrigger(content, selection.start);
  const mentionQuery = mentionTrigger?.query ?? "";
  const mentionSearchQuery = assetSearchQuery(mentionQuery);
  const mentionAssetKind = assetKindHint(mentionQuery);
  const mentionOpen = mentionTrigger !== null;
  const shouldFetchAssetSuggestions =
    !readOnly && mentionOpen && !(mentionAssetKind === "file" && !mentionSearchQuery);
  const [assetSuggestions, setAssetSuggestions] = useState<MentionSuggestion[]>([]);

  const [prevMentionQuery, setPrevMentionQuery] = useState(mentionQuery);
  if (mentionQuery !== prevMentionQuery) {
    setPrevMentionQuery(mentionQuery);
    setActiveMentionIndex(0);
  }

  const [prevShouldFetchAssetSuggestions, setPrevShouldFetchAssetSuggestions] = useState(
    shouldFetchAssetSuggestions,
  );
  if (shouldFetchAssetSuggestions !== prevShouldFetchAssetSuggestions) {
    setPrevShouldFetchAssetSuggestions(shouldFetchAssetSuggestions);
    if (!shouldFetchAssetSuggestions) {
      setAssetSuggestions([]);
    }
  }

  useEffect(() => {
    if (!shouldFetchAssetSuggestions) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadWorkspaceAssetSuggestions(mentionSearchQuery).then((items) => {
        if (!cancelled) setAssetSuggestions(items);
      });
    }, mentionSearchQuery ? 200 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionAssetKind, mentionSearchQuery, shouldFetchAssetSuggestions]);

  const groupedMentionSuggestions = useMemo(() => {
    if (!mentionTrigger) return null;
    const searchQuery = mentionSearchQuery.toLowerCase();
    const members =
      mentionAssetKind === null
        ? mentionSuggestions.filter((s) => {
            if (s.kind === "file" || s.kind === "folder") return false;
            if (!searchQuery) return true;
            return (
              s.name.toLowerCase().includes(searchQuery) ||
              (s.detail ?? "").toLowerCase().includes(searchQuery)
            );
          })
        : [];
    const files =
      mentionAssetKind !== "folder"
        ? assetSuggestions.filter((s) => s.kind === "file")
        : [];
    const folders =
      mentionAssetKind !== "file"
        ? assetSuggestions.filter((s) => s.kind === "folder")
        : [];
    if (!members.length && !files.length && !folders.length) return null;
    return { members, files, folders };
  }, [assetSuggestions, mentionAssetKind, mentionSearchQuery, mentionSuggestions, mentionTrigger]);

  const mentionMenuSections = useMemo(() => {
    if (!groupedMentionSuggestions) return [];
    const { members, folders, files } = groupedMentionSuggestions;
    const sections: Array<{ label: string; items: MentionSuggestion[] }> = [];
    if (members.length) sections.push({ label: "Members", items: members });
    if (folders.length) sections.push({ label: "Folders", items: folders });
    if (files.length) sections.push({ label: "Files", items: files });
    return sections;
  }, [groupedMentionSuggestions]);

  const flatSuggestions = useMemo(() => {
    const items: MentionSuggestion[] = [];
    for (const section of mentionMenuSections) {
      items.push(...section.items);
    }
    return items;
  }, [mentionMenuSections]);

  const mentionSectionOffsets = useMemo(() => {
    const offsets: number[] = [];
    let next = 0;
    for (const section of mentionMenuSections) {
      offsets.push(next);
      next += section.items.length;
    }
    return offsets;
  }, [mentionMenuSections]);
  const mentionMenuOpen = mentionOpen && flatSuggestions.length > 0;
  const activeReplyTo = readOnly ? null : replyTo;
  const activeSlashSelection = Math.min(
    activeSlashIndex,
    Math.max(displayedSlashOptions.length - 1, 0),
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
    voice.stopListening();
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
    if (readOnly || uploading) return;
    void uploadFiles(files);
  };

  const handleAttachmentInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (readOnly) {
      event.currentTarget.value = "";
      return;
    }
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    handleFiles(files);
  };

  const handleDrag = (next: boolean) => {
    if (readOnly) return;
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
    let mentionValue: string;
    if (suggestion.kind === 'file') {
      mentionValue = `@file:${suggestion.path ?? suggestion.name} `;
    } else if (suggestion.kind === 'folder') {
      mentionValue = `@folder:${suggestion.path ?? suggestion.name} `;
    } else {
      mentionValue = `@${suggestion.name} `;
    }
    const next = `${before}${mentionValue}${after}`;
    const nextCaret = before.length + mentionValue.length;
    setContent(next);
    setSelection({ start: nextCaret, end: nextCaret });
    setActiveMentionIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const send = async () => {
    const next = content.trim();
    if (isSending || uploading || (next.length === 0 && attachments.length === 0)) return;

    voice.stopListening();
    setError(null);
    setIsSending(true);
    try {
      await onSend(next, attachments.map((attachment) => attachment.id), {
        ...(goalMode ? { goalMode: true } : {}),
        reasoningEffort: selectedReasoningEffort,
      });
      for (const attachment of attachments) {
        revokePreviewUrl(attachment);
      }
      setContent("");
      setSelection({ start: 0, end: 0 });
      setAttachments([]);
      setUploadProgress(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  };

  const runSlashCommand = async (command: SlashMenuOption) => {
    if (isSending || isCommanding || uploading) return;
    if (command.kind === "builtin" && command.command === "goal") {
      onGoalModeChange?.(!goalMode);
      setError(null);
      setContent("");
      setSelection({ start: 0, end: 0 });
      setClearConfirmation(false);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
      return;
    }
    if (command.kind === "builtin" && command.command === "clear") {
      setClearConfirmation(true);
      setError(null);
      return;
    }

    setError(null);
    setIsCommanding(true);
    voice.stopListening();
    try {
      const currentContent = content;
      if (command.kind === "skill") {
        await onSkillCommand?.(command.id, currentContent, {
          ...(goalMode ? { goalMode: true } : {}),
          reasoningEffort: selectedReasoningEffort,
        });
      } else {
        await onCommand(command.command as ThreadCommand, currentContent, {
          ...(goalMode ? { goalMode: true } : {}),
          reasoningEffort: selectedReasoningEffort,
        });
      }
      setContent("");
      setSelection({ start: 0, end: 0 });
      setAttachments([]);
      setUploadProgress(0);
      setClearConfirmation(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run command.");
    } finally {
      setIsCommanding(false);
    }
  };

  const confirmClear = async () => {
    setIsCommanding(true);
    voice.stopListening();
    try {
      const currentContent = content;
      await onCommand("clear", currentContent);
      setContent("");
      setSelection({ start: 0, end: 0 });
      setAttachments([]);
      setUploadProgress(0);
      setClearConfirmation(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run clear command.");
    } finally {
      setIsCommanding(false);
    }
  };

  const submitComposer = async () => {
    if (showStopInsteadOfSend) {
      await stopRun();
      return;
    }
    if (exactSlashCommand) {
      await runSlashCommand(exactSlashCommand);
      return;
    }
    await send();
  };

  const stopRun = async () => {
    if (!stoppableRunIds?.length || !onStopRun || isStopping) return;
    setError(null);
    setIsStopping(true);
    try {
      const results = await Promise.allSettled(stoppableRunIds.map((runId) => onStopRun(runId)));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) {
        setError(failure.reason instanceof Error ? failure.reason.message : "Unable to stop the run.");
      }
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div className="shrink-0 px-3 pt-1.5 pb-0">
      <div
        className={`relative group ${isDragging ? "ring-2 ring-zinc-300/80 ring-offset-2 ring-offset-transparent dark:ring-zinc-600" : ""}`}
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
        <ConfirmDialog
          isOpen={clearConfirmation}
          onClose={() => { if (!isCommanding) { setClearConfirmation(false); setContent(""); setError(null); } }}
          title="Clear conversation"
          message="Older messages are summarized into one archive note and hidden from the thread. This can't be undone."
          confirmLabel="Clear"
          cancelLabel="Cancel"
          variant="primary"
          busy={isCommanding}
          onConfirm={confirmClear}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleAttachmentInput}
        />
        <div className={`relative z-10 flex flex-col rounded-lg border border-zinc-200 bg-zinc-50 transition-all focus-within:border-zinc-300 focus-within:bg-white focus-within:ring-1 focus-within:ring-zinc-200/80 dark:border-zinc-800 dark:bg-zinc-900/50 dark:focus-within:border-zinc-600 dark:focus-within:bg-[#09090b] dark:focus-within:ring-zinc-800/80 ${goalMode ? "bg-zinc-100/80 dark:bg-zinc-900/80" : ""}`}>
          {activeReplyTo && (
            <div className="flex items-center gap-2 rounded-t-lg border-b border-zinc-200 bg-violet-50/50 px-2 py-1 dark:border-zinc-800 dark:bg-violet-500/5">
              <div className="flex-1 min-w-0">
                <p className="truncate text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                  Replying to {activeReplyTo.name}
                </p>
                <MarkdownInline
                  content={activeReplyTo.content}
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
          {!readOnly && slashMenuOpen ? (
            <div className="mx-2 mb-1 flex max-h-[min(18rem,40vh)] flex-col overflow-hidden rounded-lg bg-zinc-100/70 ring-1 ring-zinc-200/70 dark:bg-zinc-950/60 dark:ring-zinc-800/70">
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                <div className="space-y-1">
                  {displayedSlashOptions.map((option, index) => (
                    <button
                      key={option.kind === "skill" ? option.id : option.command}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        void runSlashCommand(option);
                      }}
                      className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-xs transition ${
                        index === activeSlashSelection ? listItemSelected : listItemIdle
                      }`}
                    >
                      <span
                        title={option.label}
                        className="mt-0.5 max-w-[11rem] shrink-0 truncate rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
                      >
                        {option.label}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[10px] leading-4 ${
                            index === activeSlashSelection
                              ? listItemSubtitleSelected
                              : listItemSubtitleIdle
                          }`}
                        >
                          {option.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              {hasMoreSlashCommands ? (
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    setSlashMenuExpanded(true);
                  }}
                  className="shrink-0 border-t border-zinc-200/80 px-3 py-2 text-center text-[10px] font-semibold text-violet-700 transition hover:bg-zinc-200/60 dark:border-zinc-800 dark:text-violet-300 dark:hover:bg-zinc-900/80"
                >
                  Show {hiddenSlashCount} more
                </button>
              ) : null}
            </div>
          ) : null}
          {!readOnly && visibleAttachments.length > 0 ? (
            <div className="border-t border-zinc-200 px-2 py-1.5 dark:border-zinc-800">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {visibleAttachments.map((attachment) => {
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
          <div className="relative flex min-h-12 items-center gap-1.5 px-2 py-2">
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                aria-label="Open commands"
                title="Open commands"
                disabled={readOnly}
                onClick={() => {
                  if (readOnly) return;
                  setContent((value) => (value.trim().length === 0 ? "/" : value));
                  setClearConfirmation(false);
                  requestAnimationFrame(() => {
                    textareaRef.current?.focus();
                    textareaRef.current?.setSelectionRange(1, 1);
                  });
                }}
                className="text-zinc-400 transition hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-zinc-300"
              >
                <Plus className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Attach file"
                onClick={() => fileInputRef.current?.click()}
                disabled={readOnly || uploading || voice.isListening}
                className="text-zinc-400 hover:text-zinc-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-zinc-300"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </div>
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={composerPlaceholder}
              value={content}
              disabled={readOnly}
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
              }}
              onKeyDown={(event) => {
                if (exactSlashCommand && event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void runSlashCommand(exactSlashCommand);
                  return;
                }
                if (slashMenuOpen) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveSlashIndex((index) =>
                      (index + 1) % displayedSlashOptions.length,
                    );
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveSlashIndex((index) =>
                      (index - 1 + displayedSlashOptions.length) % displayedSlashOptions.length,
                    );
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    const selected = displayedSlashOptions[activeSlashSelection] ?? displayedSlashOptions[0];
                    if (selected) {
                      void runSlashCommand(selected);
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
                      (index + 1) % flatSuggestions.length,
                    );
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveMentionIndex((index) =>
                      (index - 1 + flatSuggestions.length) %
                      flatSuggestions.length,
                    );
                    return;
                  }
                  if (event.key === "Enter" || event.key === "Tab") {
                    event.preventDefault();
                    insertMention(
                      flatSuggestions[activeMentionIndex] ??
                        flatSuggestions[0],
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
              className="min-h-5 min-w-0 flex-1 resize-none bg-transparent py-0 text-sm leading-5 focus:outline-none"
            />
          {!readOnly && mentionMenuOpen ? (
            <div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-44 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
              {mentionMenuSections.map((section, sectionIndex) => (
                  <div key={section.label}>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      {section.label}
                    </div>
                    {section.items.map((suggestion, itemIndex) => {
                      const index = (mentionSectionOffsets[sectionIndex] ?? 0) + itemIndex;
                      return (
                        <button
                          key={suggestion.id}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault();
                            insertMention(suggestion);
                          }}
                          onMouseEnter={() => setActiveMentionIndex(index)}
                          className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition ${
                            index === activeMentionIndex ? listItemSelected : listItemIdle
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {suggestion.kind === "folder" ? (
                              <svg className="h-3.5 w-3.5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                              </svg>
                            ) : suggestion.kind === "file" ? (
                              <svg className="h-3.5 w-3.5 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                            ) : null}
                            <span className="font-semibold">
                              {suggestion.kind === "file" || suggestion.kind === "folder"
                                ? suggestion.name
                                : `@${suggestion.name}`}
                            </span>
                          </span>
                          <span
                            className={`ml-2 truncate text-[10px] ${
                              index === activeMentionIndex
                                ? listItemSubtitleSelected
                                : listItemSubtitleIdle
                            }`}
                          >
                            {suggestion.kind === "file" || suggestion.kind === "folder"
                              ? suggestion.path
                              : suggestion.detail}
                          </span>
                        </button>
                      );
                    })}
                  </div>
              ))}
            </div>
          ) : null}
            <div className="flex shrink-0 items-center gap-1.5">
              {goalMode ? (
                <button
                  type="button"
                  aria-label="Disable goal mode"
                  aria-pressed="true"
                  title="Goal mode active — click to disable"
                  disabled={readOnly}
                  onClick={() => onGoalModeChange?.(false)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-violet-50 px-2 text-[11px] font-medium text-violet-700 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/15"
                >
                  <RunningFigureIndicator />
                  Goal
                </button>
              ) : null}
              {showReasoningSelect ? (
                <Select
                  size="sm"
                  value={selectedReasoningEffort}
                  onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                  options={reasoningOptions}
                  placeholder="Reasoning"
                  ariaLabel="Reasoning effort"
                  menuPlacement="up"
                  className="w-[8.5rem] sm:w-[10.5rem]"
                  menuClassName="min-w-full w-max max-w-[calc(100vw-1.5rem)]"
                  disabled={reasoningDisabled}
                />
              ) : null}
              {canStopRun && !showStopInsteadOfSend && (
                <button
                  type="button"
                  aria-label={stopRunLabel}
                  title={stopRunLabel}
                  onClick={() => void stopRun()}
                  disabled={isStopping}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-600 text-white shadow-lg shadow-red-500/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isStopping ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-3 w-3 fill-current" />
                  )}
                </button>
              )}
              {voice.isListening ? (
                <VoiceInputWaves levels={voice.audioLevels} className="mr-0.5" />
              ) : null}
              {showStopInsteadOfSend ? (
                <button
                  type="button"
                  aria-label={stopRunLabel}
                  title={stopRunLabel}
                  onClick={() => void stopRun()}
                  disabled={isStopping}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-600 text-white shadow-lg shadow-red-500/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isStopping ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-3 w-3 fill-current" />
                  )}
                </button>
              ) : voice.isListening && canSend ? (
                <button
                  type="button"
                  disabled={working}
                  onClick={() => void submitComposer()}
                  aria-label="Send message"
                  title="Send message"
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600 text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              ) : null}
              {showStopInsteadOfSend ? null : voice.isListening ? (
                <button
                  type="button"
                  aria-label="Stop listening"
                  aria-pressed
                  title="Stop listening"
                  disabled={working}
                  onClick={voice.stopListening}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-600 text-white shadow-lg shadow-red-500/20 transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              ) : showVoiceInsteadOfSend ? (
                <button
                  type="button"
                  aria-label="Voice message"
                  title="Voice message"
                  disabled={working}
                  onClick={voice.toggleListening}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600 text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Mic className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={working || !canSend}
                  onClick={() => void submitComposer()}
                  aria-label={
                    exactSlashCommand?.command === "clear"
                      ? "Clear conversation"
                      : exactSlashCommand?.command === "summarize"
                        ? "Run summarize"
                        : exactSlashCommand?.command === "schedule"
                          ? "Ask agent to schedule"
                        : "Send message"
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-600 text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              )}
            </div>
          </div>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

export const ChatInput = memo(ChatInputComponent);
