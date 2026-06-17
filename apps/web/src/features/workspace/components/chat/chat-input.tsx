"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  ListTodo,
  Loader2,
  Mic,
  Paperclip,
  Plus,
  Send,
  Square,
  Zap,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/features/settings/shared/confirm-dialog";
import { AttachmentSchema, type AttachmentCategory } from "@ujima/shared/browser";
import {
  clampReasoningEffortForProvider,
  ASSET_REF_PATTERN,
  decodeAssetReference,
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



const assetKinds = ["file", "folder", "mcp", "skill", "task", "culture"] as const;
type AssetMentionKind = (typeof assetKinds)[number];
type NamedAssetKind = Exclude<AssetMentionKind, "file" | "folder">;

export interface MentionSuggestion {
  id: string;
  name: string;
  detail?: string;
  kind?: "member" | AssetMentionKind;
  path?: string;
}

type SlashMenuOption = { kind: "builtin" } & (typeof BUILTIN_SLASH_COMMANDS)[number];

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

const BUILTIN_SLASH_COMMANDS: {
  command: ComposerCommand;
  label: string;
  description: string;
}[] = [
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
  const separator = raw.indexOf(":");
  return separator < 0 ? raw.trim() : raw.slice(separator + 1).trim();
}

function assetKindHint(raw: string): AssetMentionKind | null {
  const separator = raw.indexOf(":");
  if (separator < 0) return null;
  const kind = raw.slice(0, separator).toLowerCase();
  return assetKinds.includes(kind as AssetMentionKind) ? kind as AssetMentionKind : null;
}

interface WorkspaceAssetHit {
  kind: AssetMentionKind;
  name: string;
  path?: string;
  id?: string;
  detail?: string;
}

function toAssetSuggestion(entry: WorkspaceAssetHit): MentionSuggestion {
  return {
    id: `${entry.kind}:${entry.path}`,
    name: entry.name,
    kind: entry.kind,
    path: entry.path,
    detail: entry.path,
  };
}

const CACHED_LIST_TTL_MS = 60_000;
let cachedRootFolders: { at: number; items: MentionSuggestion[] } | null = null;
const namedAssetKinds: NamedAssetKind[] = ["mcp", "skill", "task", "culture"];
const assetDisplay = {
  file: [FileIcon, "text-blue-500", "Files"],
  folder: [Folder, "text-amber-500", "Folders"],
  mcp: [ArrowRight, "text-emerald-500", "MCPs"],
  skill: [Zap, "text-purple-500", "Skills"],
  task: [ListTodo, "text-rose-500", "Tasks"],
  culture: [BookOpen, "text-sky-500", "Culture"],
} satisfies Record<AssetMentionKind, readonly [typeof FileIcon, string, string]>;
let cachedNamedAssets: { at: number; items: MentionSuggestion[] } | null = null;

function isNamedAssetKind(kind: AssetMentionKind | null): kind is NamedAssetKind {
  return kind !== null && kind !== "file" && kind !== "folder";
}

function AssetSuggestionIcon({ kind }: { kind?: MentionSuggestion["kind"] }) {
  if (!kind || kind === "member") return null;
  const [Icon, color] = assetDisplay[kind];
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />;
}

interface AtomicTokenRange {
  start: number;
  end: number;
}

type ComposerPart =
  | { type: "text"; start: number; end: number; text: string }
  | {
      type: "asset";
      start: number;
      end: number;
      raw: string;
      trailingSpace: boolean;
      kind: AssetMentionKind;
      label: string;
    }
  | {
      type: "mention";
      start: number;
      end: number;
      raw: string;
      trailingSpace: boolean;
      name: string;
    };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ASSET_ICON_SVG: Record<AssetMentionKind, string> = {
  file: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-blue-500" style="display:inline-block;vertical-align:middle;"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>',
  folder: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-amber-500" style="display:inline-block;vertical-align:middle;"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  mcp: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-emerald-500" style="display:inline-block;vertical-align:middle;"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  skill: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-purple-500" style="display:inline-block;vertical-align:middle;"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>',
  task: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-rose-500" style="display:inline-block;vertical-align:middle;"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>',
  culture: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-sky-500" style="display:inline-block;vertical-align:middle;"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>',
};

function renderPartsToHtml(parts: ComposerPart[]): string {
  let html = "";
  for (const part of parts) {
    if (part.type === "text") {
      html += escapeHtml(part.text);
    } else if (part.type === "asset") {
      const margin = part.trailingSpace ? " margin-right:0.25rem;" : "";
      html += `<span contenteditable="false" data-composer-token data-raw="${escapeHtml(part.raw)}" data-start="${part.start}" data-end="${part.end}" class="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" style="user-select:all;${margin}">${ASSET_ICON_SVG[part.kind]}<span>${escapeHtml(part.label)}</span></span>\u200B`;
    } else {
      const margin = part.trailingSpace ? " margin-right:0.25rem;" : "";
      html += `<span contenteditable="false" data-composer-token data-raw="${escapeHtml(part.raw)}" data-start="${part.start}" data-end="${part.end}" class="inline-flex items-center rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" style="user-select:all;${margin}">@${escapeHtml(part.name)}</span>\u200B`;
    }
  }
  return html;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function memberMentionNames(suggestions: MentionSuggestion[]): string[] {
  return [...new Set(["all", ...suggestions
    .filter((item) => !item.kind || item.kind === "member")
    .map((item) => item.name)
    .filter(Boolean)])].sort((a, b) => b.length - a.length);
}

function memberMentionPattern(suggestions: MentionSuggestion[]): RegExp {
  const names = memberMentionNames(suggestions);
  return new RegExp(`(^|[^@\\w])@(${names.map(escapeRegex).join("|")})(?=\\s|[^\\w]|$)`, "g");
}

function composerParts(value: string, suggestions: MentionSuggestion[]): ComposerPart[] {
  const tokens: Extract<ComposerPart, { type: "asset" | "mention" }>[] = [];
  let match: RegExpExecArray | null;

  ASSET_REF_PATTERN.lastIndex = 0;
  while ((match = ASSET_REF_PATTERN.exec(value))) {
    const kind = match[1] as AssetMentionKind | undefined;
    const encodedPath = match[2];
    if (!kind || !encodedPath) continue;
    const rawEnd = match.index + match[0].length;
    const trailingSpace = value[rawEnd] === " ";
    const path = decodeAssetReference(encodedPath);
    tokens.push({
      type: "asset",
      start: match.index,
      end: rawEnd + (trailingSpace ? 1 : 0),
      raw: value.slice(match.index, rawEnd + (trailingSpace ? 1 : 0)),
      trailingSpace,
      kind,
      label: path.split("/").pop() || path,
    });
  }

  const mentionPattern = memberMentionPattern(suggestions);
  while ((match = mentionPattern.exec(value))) {
    const prefix = match[1] ?? "";
    const name = match[2] ?? "";
    const start = match.index + prefix.length;
    const rawEnd = start + name.length + 1;
    const trailingSpace = value[rawEnd] === " ";
    tokens.push({
      type: "mention",
      start,
      end: rawEnd + (trailingSpace ? 1 : 0),
      raw: value.slice(start, rawEnd + (trailingSpace ? 1 : 0)),
      trailingSpace,
      name,
    });
  }

  tokens.sort((a, b) => a.start - b.start);
  const parts: ComposerPart[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor) continue;
    if (token.start > cursor) {
      parts.push({ type: "text", start: cursor, end: token.start, text: value.slice(cursor, token.start) });
    }
    parts.push(token);
    cursor = token.end;
  }
  if (cursor < value.length) {
    parts.push({ type: "text", start: cursor, end: value.length, text: value.slice(cursor) });
  }
  return parts;
}

function atomicDeleteRange(
  value: string,
  start: number,
  end: number,
  key: string,
  suggestions: MentionSuggestion[],
): AtomicTokenRange | null {
  if (key !== "Backspace" && key !== "Delete" && key !== "Clear") return null;
  const ranges = composerParts(value, suggestions).filter((part) => part.type !== "text");
  if (start !== end) {
    const touched = ranges.filter((range) => start < range.end && end > range.start);
    if (!touched.length) return null;
    return {
      start: Math.min(start, ...touched.map((range) => range.start)),
      end: Math.max(end, ...touched.map((range) => range.end)),
    };
  }

  if (key === "Backspace") {
    return ranges.find((range) => start > range.start && start <= range.end) ?? null;
  }
  if (key === "Delete" || key === "Clear") {
    return ranges.find((range) => start >= range.start && start < range.end) ?? null;
  }
  return null;
}



function rawLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "").length;
  if (!(node instanceof HTMLElement)) return 0;
  if (node.dataset.raw !== undefined) return node.dataset.raw.length;
  return Array.from(node.childNodes).reduce((sum, child) => sum + rawLength(child), 0);
}

function rawBefore(editor: HTMLElement, node: Node): number {
  let total = 0;
  let current: Node | null = node;
  while (current && current !== editor) {
    let sibling = current.previousSibling;
    while (sibling) {
      total += rawLength(sibling);
      sibling = sibling.previousSibling;
    }
    current = current.parentNode;
  }
  return total;
}

function rawOffset(editor: HTMLElement, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    const textUpToOffset = (container.textContent ?? "").slice(0, offset).replace(/\u200B/g, "");
    return rawBefore(editor, container) + textUpToOffset.length;
  }
  if (container instanceof HTMLElement && container.dataset.raw !== undefined) {
    return rawBefore(editor, container) + (offset > 0 ? container.dataset.raw.length : 0);
  }
  return rawBefore(editor, container) + Array.from(container.childNodes)
    .slice(0, offset)
    .reduce((sum, child) => sum + rawLength(child), 0);
}

function editorSelection(editor: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
  return {
    start: rawOffset(editor, range.startContainer, range.startOffset),
    end: rawOffset(editor, range.endContainer, range.endOffset),
  };
}

function boundaryForOffset(parent: Node, offset: number): { node: Node; offset: number } {
  let remaining = offset;
  const children = Array.from(parent.childNodes);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const length = rawLength(child);
    if (remaining <= length) {
      if (child.nodeType === Node.TEXT_NODE) return { node: child, offset: remaining };
      if (child instanceof HTMLElement && child.dataset.raw !== undefined) {
        return { node: parent, offset: remaining <= 0 ? index : index + 1 };
      }
      return boundaryForOffset(child, remaining);
    }
    remaining -= length;
  }
  return { node: parent, offset: children.length };
}

function placeEditorCaret(editor: HTMLElement, offset: number) {
  const boundary = boundaryForOffset(editor, Math.max(0, offset));
  const range = document.createRange();
  range.setStart(boundary.node, boundary.offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function readEditorRaw(editor: HTMLElement): string {
  return Array.from(editor.childNodes)
    .map((node) => {
      if (node instanceof HTMLElement && node.dataset.raw !== undefined) return node.dataset.raw;
      return node.textContent ?? "";
    })
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/\u200B/g, "");
}

async function loadWorkspaceAssetSuggestions(searchQuery: string): Promise<MentionSuggestion[]> {
  const url = searchQuery
    ? `/api/workspaces/search?q=${encodeURIComponent(searchQuery)}`
    : "/api/workspaces/search";
  if (!searchQuery) {
    const now = Date.now();
    if (cachedRootFolders && now - cachedRootFolders.at < CACHED_LIST_TTL_MS) {
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

async function loadNamedAssetSuggestions(): Promise<MentionSuggestion[]> {
  const now = Date.now();
  if (cachedNamedAssets && now - cachedNamedAssets.at < CACHED_LIST_TTL_MS) {
    return cachedNamedAssets.items;
  }
  const res = await fetch("/api/workspaces/assets", { credentials: "include" });
  if (!res.ok) return [];
  const results = (await res.json()) as WorkspaceAssetHit[];
  const items = results.map(({ id, name, kind, detail }) => ({
    id: id ?? name, name, kind, detail: detail ?? "",
  }));
  cachedNamedAssets = { at: now, items };
  return items;
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
  const editorRef = useRef<HTMLDivElement>(null);
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

  const focusEditorAt = useCallback((offset: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    placeEditorCaret(editor, offset);
  }, []);

  const updateSelectionFromEditor = useCallback(() => {
    const editor = editorRef.current;
    const next = editor ? editorSelection(editor) : null;
    if (next) setSelection(next);
  }, []);

  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  const lastRenderedHtmlRef = useRef("");
  const pendingCaretRef = useRef<number | null>(null);

  // DOM-sync effect: rebuild innerHTML only when token structure changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const parts = composerParts(content, mentionSuggestions);
    const nextHtml = renderPartsToHtml(parts);

    // Only rebuild the DOM when the rendered HTML actually differs.
    // During normal typing the browser handles its own text nodes;
    // we only intervene for programmatic updates (inserts, deletes, pastes).
    if (nextHtml !== lastRenderedHtmlRef.current) {
      lastRenderedHtmlRef.current = nextHtml;
      editor.innerHTML = nextHtml;

      const caret = pendingCaretRef.current ?? content.length;
      pendingCaretRef.current = null;
      requestAnimationFrame(() => {
        editor.focus();
        placeEditorCaret(editor, caret);
      });
    } else if (pendingCaretRef.current !== null) {
      // HTML didn't change but a programmatic action needs the caret placed
      const caret = pendingCaretRef.current;
      pendingCaretRef.current = null;
      requestAnimationFrame(() => {
        editor.focus();
        placeEditorCaret(editor, caret);
      });
    }
  }, [content, mentionSuggestions]);

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
      requestAnimationFrame(() => focusEditorAt(contentRef.current.length));
    }
  }, [focusEditorAt, readOnly, replyTo]);
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
    ],
    [],
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
  const [namedAssetSuggestions, setNamedAssetSuggestions] = useState<
    Record<NamedAssetKind, MentionSuggestion[]>
  >({ mcp: [], skill: [], task: [], culture: [] });

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
      if (!mentionAssetKind || mentionAssetKind === "file" || mentionAssetKind === "folder") {
        void loadWorkspaceAssetSuggestions(mentionSearchQuery).then((items) => {
          if (!cancelled) setAssetSuggestions(items);
        });
      }
      if (!mentionAssetKind || isNamedAssetKind(mentionAssetKind)) {
        void loadNamedAssetSuggestions().then((items) => {
          if (!cancelled) {
            setNamedAssetSuggestions(Object.fromEntries(
              namedAssetKinds.map((kind) => [kind, items.filter((item) => item.kind === kind)]),
            ) as Record<NamedAssetKind, MentionSuggestion[]>);
          }
        });
      }
    }, mentionSearchQuery ? 200 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mentionAssetKind, mentionSearchQuery, shouldFetchAssetSuggestions]);

  const mentionMenuSections = useMemo(() => {
    if (!mentionTrigger) return [];
    const searchQuery = mentionSearchQuery.toLowerCase();
    const matches = (suggestion: MentionSuggestion) =>
      !searchQuery ||
      suggestion.name.toLowerCase().includes(searchQuery) ||
      (suggestion.detail ?? "").toLowerCase().includes(searchQuery);
    const visible = (kind: AssetMentionKind) => !mentionAssetKind || mentionAssetKind === kind;
    return [
      {
        label: "Members",
        items: !mentionAssetKind
          ? mentionSuggestions.filter((item) => (!item.kind || item.kind === "member") && matches(item))
          : [],
      },
      ...namedAssetKinds.map((kind) => ({
        label: assetDisplay[kind][2],
        items: visible(kind) ? namedAssetSuggestions[kind].filter(matches) : [],
      })),
      ...(["folder", "file"] as const).map((kind) => ({
        label: assetDisplay[kind][2],
        items: visible(kind) ? assetSuggestions.filter((item) => item.kind === kind) : [],
      })),
    ].filter((section) => section.items.length);
  }, [assetSuggestions, mentionAssetKind, mentionSearchQuery, mentionSuggestions, mentionTrigger, namedAssetSuggestions]);

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
    const isAsset = suggestion.kind && suggestion.kind !== "member";
    const value = suggestion.kind === "file" || suggestion.kind === "folder"
      ? suggestion.path ?? suggestion.name
      : suggestion.name;
    const mentionValue = isAsset
      ? `@${suggestion.kind}:${encodeURIComponent(value)} `
      : `@${suggestion.name} `;
    const next = `${before}${mentionValue}${after}`;
    const nextCaret = before.length + mentionValue.length;
    pendingCaretRef.current = nextCaret;
    setContent(next);
    setSelection({ start: nextCaret, end: nextCaret });
    setActiveMentionIndex(0);
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
      requestAnimationFrame(() => focusEditorAt(0));
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
      await onCommand(command.command as ThreadCommand, currentContent, {
        ...(goalMode ? { goalMode: true } : {}),
        reasoningEffort: selectedReasoningEffort,
      });
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
                      key={option.command}
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
                  requestAnimationFrame(() => focusEditorAt(1));
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
            <div className="relative min-h-6 min-w-0 flex-1">
              {!content ? (
                <span className="pointer-events-none absolute inset-0 text-sm leading-6 text-zinc-400">
                  {composerPlaceholder}
                </span>
              ) : null}
              <div
                ref={editorRef}
                role="textbox"
                aria-multiline="true"
                contentEditable={!readOnly}
                suppressContentEditableWarning
                className="relative z-10 max-h-[4.5rem] min-h-6 w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent py-0 text-sm leading-6 text-zinc-900 caret-foreground outline-none [overflow-wrap:anywhere] dark:text-zinc-100"

                onInput={(event) => {
                  const editor = event.currentTarget;
                  const next = readEditorRaw(editor);
                  const nextSelection = editorSelection(editor) ?? { start: next.length, end: next.length };

                  // Compute what the rendered HTML *would* be for this new text.
                  // If it matches what we last wrote, the browser handled the
                  // edit natively and we only need to sync React state — no
                  // innerHTML rebuild needed (the DOM-sync useEffect will
                  // see matching HTML and skip the write).
                  const parts = composerParts(next, mentionSuggestions);
                  const html = renderPartsToHtml(parts);
                  lastRenderedHtmlRef.current = html;

                  setContent(next);
                  setSelection(nextSelection);
                  setActiveMentionIndex(0);
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  const liveSelection = editorSelection(event.currentTarget) ?? selection;
                  const pasteText = event.clipboardData.getData("text/plain");
                  const current = contentRef.current;
                  const next = current.slice(0, liveSelection.start) + pasteText + current.slice(liveSelection.end);
                  const nextCaret = liveSelection.start + pasteText.length;
                  pendingCaretRef.current = nextCaret;
                  setContent(next);
                  setSelection({ start: nextCaret, end: nextCaret });
                  setActiveMentionIndex(0);
                }}
                onSelect={updateSelectionFromEditor}
                onClick={() => {
                  updateSelectionFromEditor();
                  setActiveMentionIndex(0);
                }}
                onKeyUp={updateSelectionFromEditor}
                onKeyDown={(event) => {
                  const liveSelection = editorSelection(event.currentTarget) ?? selection;
                  const tokenDelete = atomicDeleteRange(
                    content,
                    liveSelection.start,
                    liveSelection.end,
                    event.key,
                    mentionSuggestions,
                  );
                  if (tokenDelete) {
                    event.preventDefault();
                    const next = content.slice(0, tokenDelete.start) + content.slice(tokenDelete.end);
                    pendingCaretRef.current = tokenDelete.start;
                    setContent(next);
                    setSelection({ start: tokenDelete.start, end: tokenDelete.start });
                    setActiveMentionIndex(0);
                    return;
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
                    pendingCaretRef.current = 0;
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
              />
            </div>
          {!readOnly && mentionMenuOpen ? (
            <div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-80 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950">
              {mentionMenuSections.map((section, sectionIndex) => (
                  <div key={section.label}>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                      {section.label}
                    </div>
                    {section.items.map((suggestion, itemIndex) => {
                      const index = (mentionSectionOffsets[sectionIndex] ?? 0) + itemIndex;
                      const isAsset = suggestion.kind && suggestion.kind !== "member";
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
                            <AssetSuggestionIcon kind={suggestion.kind} />
                            <span className="font-semibold">
                              {isAsset ? suggestion.name : `@${suggestion.name}`}
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
