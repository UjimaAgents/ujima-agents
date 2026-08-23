import { memo, useCallback, useEffect, useRef, useState, forwardRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type UIEventHandler } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronDown, Copy, CornerDownRight, Download, ListTodo, Loader2, Maximize2, Play, Reply, Sparkles, X, XCircle } from "lucide-react";
import {
  CONVERSATION_ARCHIVE_MARKER,
  CONVERSATION_ROLLING_SUMMARY_MARKERS,
  SELF_NOTE_SUMMARY_MARKER,
  hasAnyMessageMarker,
  type AttachmentCategory,
} from "@ujima/shared/browser";
import type { BootstrapResponse } from "@ujima/api-schema";
import { Avatar, TagBadge, type TagVariant } from "./primitives";
import { MessageActions } from "../message-actions";
import { Markdown, MarkdownInline, normalizeCompactionSummaryMarkdown } from "../markdown";
import { AttachmentGrid } from "./attachment-grid";
import { TerminalPane } from "./terminal-pane";
import { FilesystemToolPane } from "./filesystem-tool-pane";
import { TokenCount } from "./chat-token-count";
import { Modal } from "@/components/ui/modal";
import { UnifiedDiffView } from "./unified-diff-view";
import { MessageCardsView, TaskNudgeCardView, type TaskNudgeData } from "./goal-task-cards";
import {
  getArtifactFileCard,
  getMessageCards,
  isBoilerplateStepContent,
  type ArtifactFileView,
} from "./message-cards";

export { getArtifactFileCard } from "./message-cards";

const SUMMARY_MARKERS = [CONVERSATION_ARCHIVE_MARKER, ...CONVERSATION_ROLLING_SUMMARY_MARKERS, SELF_NOTE_SUMMARY_MARKER];
const SUMMARY_GUIDANCE = new Set([
  "> README-style compact summary -- your durable context from earlier in the conversation.",
  "> Treat these notes as your own continuity. Details that don't carry forward are safe to forget.",
]);

export interface ChatMessageData {
  id: string;
  clientMessageId?: string;
  senderId?: string;
  parentMessageId?: string;
  role: string;
  name: string;
  time: string;
  content: string;
  kind?: "human" | "agent" | "system";
  createdAt?: string;
  threadId?: string;
  channelId?: string;
  streamRunId?: string;
  pinned?: boolean;
  mentionNames?: string[];
  attachments?: {
    id: string;
    filename: string;
    mimeType: string;
    category: AttachmentCategory;
    sizeBytes: number;
  }[];
  toolCalls?: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    result?: unknown;
    isError?: boolean;
  }[];
  replyPreview?: {
    name: string;
    content: string;
  };
  detail?: string;
  /**
   * Present on the in-channel pointer posted when a delegation runs as a
   * channel-scoped thread. Rendered as a compact, clickable row that opens
   * the delegation thread.
   */
  delegateMarker?: {
    delegationThreadId: string;
    kind: "start" | "done";
    agentName?: string;
  };
  /**
   * Present on the in-channel card posted when a workflow run starts or
   * finishes. Rendered as a compact, clickable row that opens the run view.
   */
  workflowRunMarker?: {
    workflowRunId: string;
    workflowName: string;
    phase: "started" | "completed" | "failed";
  };
  tag?: { label: string; variant: TagVariant };
  status?: "success" | "warning";
  pending?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Trace-only reasoning record for a silent (channel.pass) turn — empty
   * `content`. Kept in the store for the reasoning trace but filtered out
   * of the rendered timeline so it doesn't show as a blank bubble.
   */
  traceOnly?: boolean;
  taskNudge?: TaskNudgeData;
}

const DRAG_THRESHOLD = 30;

export const ChatMessage = memo(function ChatMessage({
  message,
  active,
  onClick,
  colorIndex = 0,
  onReply,
  organizationId,
  members = [],
  onOpenTasksTab,
  onNavigateChannel,
  onOpenWorkflowRun,
}: {
  message: ChatMessageData;
  active?: boolean;
  onClick?: () => void;
  colorIndex?: number;
  onReply?: (message: ChatMessageData) => void;
  organizationId?: string;
  members?: BootstrapResponse["members"];
  onOpenTasksTab?: () => void;
  onNavigateChannel?: (channelId: string, fallbackName?: string) => void;
  onOpenWorkflowRun?: (runId: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).catch(() => undefined);
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }, [message.content]);

  const handleContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    dragStart.current = { x: event.clientX, y: event.clientY };
    dragged.current = false;
  }, []);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!dragStart.current || !onReply) return;
      const dx = event.clientX - dragStart.current.x;
      if (dx > DRAG_THRESHOLD && !dragged.current) {
        dragged.current = true;
        onReply(message);
        dragStart.current = null;
      }
    },
    [message, onReply],
  );

  const handleMouseUp = useCallback(() => {
    dragStart.current = null;
  }, []);

  const handleRowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick?.();
        return;
      }
      if (
        (event.key === "r" || event.key === "R") &&
        onReply &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        onReply(message);
      }
    },
    [message, onClick, onReply],
  );

  useEffect(() => {
    if (!menu) return;
    const closeMenu = () => setMenu(null);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menu]);

  const systemLabel = message.kind === "system" ? getSystemMessageLabel(message.content) : null;
  const systemBodyMarkdown =
    message.kind === "system" ? systemMessageBodyMarkdown(message.content) : null;
  const approvalShellTerminal =
    message.kind === "system" && systemLabel?.includes("Shell") && systemBodyMarkdown
      ? parseRelayShellBody(systemBodyMarkdown)
      : null;
  const approvalFsTerminal =
    message.kind === "system" && systemLabel?.includes("Filesystem") && systemBodyMarkdown
      ? parseRelayFilesystemBody(systemBodyMarkdown, systemLabel)
      : null;
  const artifactFile = getArtifactFileCard(message.toolCalls);
  const inlineCards = getMessageCards(message.toolCalls).filter(
    (card) =>
      card.kind !== "artifact.file" &&
      card.kind !== "approval" &&
      card.kind !== "tool.call" &&
      card.kind !== "task.promotion-confirm",
  );
  const cardActions = { members, onOpenTasksTab, onNavigateChannel };
  const duplicateMovedNudge =
    message.taskNudge?.reason === "moved" &&
    inlineCards.some(
      (card) =>
        card.kind === "goal.task.updated" &&
        card.taskId === message.taskNudge?.taskId,
    );
  const hasTaskEventContent =
    Boolean(message.taskNudge) || inlineCards.some((card) => card.kind === "goal.task.updated");
  const showBody =
    message.content.trim().length > 0 &&
    !(artifactFile && isInternalMarkerContent(message.content)) &&
    !message.taskNudge &&
    !(
      inlineCards.length > 0 &&
      (isBoilerplateStepContent(message.content) || message.kind === "system")
    );

  if (message.delegateMarker) {
    const marker = message.delegateMarker;
    return (
      <button
        type="button"
        onClick={() => onNavigateChannel?.(marker.delegationThreadId, marker.agentName)}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-violet-300/60 bg-violet-50/40 px-3 py-1.5 text-left text-xs text-violet-700 transition hover:border-violet-400 hover:bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/5 dark:text-violet-300 dark:hover:bg-violet-500/10"
      >
        <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{message.content}</span>
        <span className="shrink-0 font-medium underline-offset-2 group-hover:underline">
          Open thread
        </span>
      </button>
    );
  }

  if (message.workflowRunMarker) {
    const marker = message.workflowRunMarker;
    const tone =
      marker.phase === "completed"
        ? {
            wrap: "border-emerald-300/60 bg-emerald-50/50 text-emerald-700 hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/5 dark:text-emerald-300 dark:hover:bg-emerald-500/10",
            Icon: CheckCircle2,
            verb: "completed",
          }
        : marker.phase === "failed"
          ? {
              wrap: "border-red-300/60 bg-red-50/50 text-red-700 hover:border-red-400 hover:bg-red-50 dark:border-red-500/30 dark:bg-red-500/5 dark:text-red-300 dark:hover:bg-red-500/10",
              Icon: XCircle,
              verb: "failed",
            }
          : {
              wrap: "border-violet-300/60 bg-violet-50/40 text-violet-700 hover:border-violet-400 hover:bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/5 dark:text-violet-300 dark:hover:bg-violet-500/10",
              Icon: Play,
              verb: "started",
            };
    const { Icon } = tone;
    const inner = (
      <>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          Workflow <span className="font-semibold">{marker.workflowName}</span> {tone.verb}
        </span>
        <span className="shrink-0 font-medium underline-offset-2 group-hover:underline">Open run →</span>
      </>
    );
    const cls = `group flex w-full items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-left text-xs transition ${tone.wrap}`;
    // Prefer the in-channel drawer; fall back to the full-page route.
    return onOpenWorkflowRun ? (
      <button type="button" onClick={() => onOpenWorkflowRun(marker.workflowRunId)} className={cls}>
        {inner}
      </button>
    ) : (
      <Link href={`/workflows/runs/${marker.workflowRunId}`} className={cls}>
        {inner}
      </Link>
    );
  }

  return (
    <>
      <div
        onClick={onClick}
        onKeyDown={handleRowKeyDown}
        tabIndex={0}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`relative group flex w-full animate-in gap-3 rounded-xl px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 dark:focus-visible:ring-violet-500/40 ${
          message.kind === "system" ? "items-center" : "items-start"
        } ${
          active
            ? "bg-violet-50/50 ring-1 ring-violet-200 dark:bg-violet-500/5 dark:ring-violet-500/20"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
        } ${message.status === "success" ? "pr-8" : ""} ${message.pending ? "opacity-70" : ""}`}
      >
        {message.kind === "system" ? (
          <>
            {!hasTaskEventContent ? (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
            ) : null}
            <div className="flex-1 min-w-0">
              {!hasTaskEventContent ? (
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                  <p className="min-w-0 max-w-full truncate text-sm font-bold text-zinc-900 dark:text-white">
                    {systemLabel}
                  </p>
                  <p className="shrink-0 text-[11px] text-zinc-400">{message.time}</p>
                </div>
              ) : null}
              {artifactFile ? <ArtifactFilePreview artifact={artifactFile} /> : null}
              {inlineCards.length > 0 ? (
                <MessageCardsView cards={inlineCards} {...cardActions} />
              ) : null}
              {message.taskNudge && !duplicateMovedNudge ? (
                <TaskNudgeCardView nudge={message.taskNudge} onOpenTasksTab={onOpenTasksTab} />
              ) : null}
              {approvalShellTerminal ? (
                <TerminalPane
                  className="mt-1.5"
                  cwd={approvalShellTerminal.cwd}
                  commandLine={approvalShellTerminal.commandLine}
                  storageKey={`msg:${message.id}:shell`}
                />
              ) : approvalFsTerminal ? (
                <FilesystemToolPane
                  className="mt-1.5"
                  action={approvalFsTerminal.action}
                  resourcePath={approvalFsTerminal.resourcePath}
                  meta={approvalFsTerminal.meta}
                  body={approvalFsTerminal.body}
                  storageKey={`msg:${message.id}:fs`}
                />
              ) : !hasTaskEventContent && systemBodyMarkdown !== null ? (
                <div className={`${artifactFile || inlineCards.length > 0 ? "mt-3" : "mt-1"} chat-message-content`}>
                  <Markdown
                    content={systemBodyMarkdown}
                    mentionNames={message.mentionNames}
                    className="text-sm"
                  />
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <Avatar name={message.name} colorIndex={colorIndex} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <p className="min-w-0 max-w-full truncate text-sm font-bold text-zinc-900 dark:text-white">
                  {message.name}
                </p>
                <p className="shrink-0 text-[11px] text-zinc-400">{message.time}</p>
                {message.tag && (
                  <TagBadge variant={message.tag.variant} label={message.tag.label} />
                )}
              </div>
              {message.replyPreview && (
                <div className="mt-1 rounded-md border-l-2 border-zinc-300 bg-zinc-100/70 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900/70">
                  <p className="truncate text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Replying to {message.replyPreview.name}
                  </p>
                  <MarkdownInline
                    content={message.replyPreview.content}
                    className="block truncate text-xs text-zinc-500 dark:text-zinc-400"
                  />
                </div>
              )}
              {artifactFile ? <ArtifactFilePreview artifact={artifactFile} /> : null}
              {inlineCards.length > 0 ? (
                <MessageCardsView cards={inlineCards} {...cardActions} />
              ) : null}
              {message.taskNudge && !duplicateMovedNudge ? (
                <TaskNudgeCardView nudge={message.taskNudge} onOpenTasksTab={onOpenTasksTab} />
              ) : null}
              <div className={`${artifactFile || inlineCards.length > 0 || message.taskNudge ? "mt-3" : "mt-1"} chat-message-content`}>
                {showBody ? (
                  <Markdown
                    content={message.content}
                    mentionNames={message.mentionNames}
                  />
                ) : null}
              </div>
              <AttachmentGrid
                attachments={message.attachments}
                organizationId={organizationId ?? ""}
              />
              {message.kind === "agent" && (message.inputTokens ?? 0) + (message.outputTokens ?? 0) > 0 && (
                <p className="mt-1 flex items-center justify-end gap-1 text-[10px] tracking-tight text-zinc-400">
                  <span className="text-zinc-500/80">⎆</span>
                  <TokenCount value={message.inputTokens ?? 0} />
                  <span>in</span>
                  <span className="text-zinc-500/70">·</span>
                  <TokenCount value={message.outputTokens ?? 0} />
                  <span>out</span>
                </p>
              )}
              {message.detail && (
                <p className="mt-0.5 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {message.detail}
                </p>
              )}
              {message.pending && message.kind !== "agent" && (
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Sending
                </div>
              )}
            </div>
          </>
        )}
        <div className="relative z-10 ml-auto flex shrink-0 self-start items-center gap-0.5 rounded-lg border border-zinc-200 bg-white/95 p-0.5 opacity-0 shadow-sm pointer-events-none backdrop-blur transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 dark:border-zinc-700 dark:bg-zinc-900/95">
          {onReply ? (
            <button
              type="button"
              aria-label="Reply"
              title="Reply"
              onClick={() => onReply?.(message)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Reply className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={copied ? "Copied" : "Copy text"}
            title={copied ? "Copied" : "Copy text"}
            onClick={handleCopy}
            className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 focus-visible:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            {copied ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        {active && (
          <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 h-8 w-0.5 rounded-full bg-violet-600" />
        )}
        {message.status === "success" && (
          <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-emerald-500 transition-opacity group-hover:opacity-0" />
        )}
      </div>
      {menu && (
        <MessageActions
          x={menu.x}
          y={menu.y}
          messageContent={message.content}
          onReply={() => onReply?.(message)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
});

export function getSystemMessageLabel(content: string): string {
  if (content.startsWith(CONVERSATION_ARCHIVE_MARKER)) return "Conversation archived";
  if (hasAnyMessageMarker(content, CONVERSATION_ROLLING_SUMMARY_MARKERS)) return "Conversation compacted";
  if (content.startsWith(SELF_NOTE_SUMMARY_MARKER)) return "Self notes compacted";
  if (content.startsWith("[Approval needed]")) {
    const firstLine = content.split("\n")[0]?.trim() ?? "";
    return firstLine.length > 0 ? firstLine : "Approval needed";
  }
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 0 ? firstLine : "System message";
}

function isInternalMarkerContent(content: string): boolean {
  return hasAnyMessageMarker(content, SUMMARY_MARKERS);
}

/** Body below the title line for system messages that carry multi-line context (e.g. approval relay). */
export function systemMessageBodyMarkdown(content: string): string | null {
  if (hasAnyMessageMarker(content, SUMMARY_MARKERS)) {
    const body = content
      .split("\n")
      .slice(1)
      .filter((line) => !SUMMARY_GUIDANCE.has(line.trim()))
      .join("\n")
      .trim();
    const normalizedBody = normalizeCompactionSummaryMarkdown(body);
    return normalizedBody.length > 0 ? normalizedBody : null;
  }
  if (content.startsWith("[Approval needed]")) {
    const rest = content.split("\n").slice(1).join("\n").trim();
    return rest.length > 0 ? rest : null;
  }
  const lines = content.split("\n");
  if (lines.length <= 1) return null;
  const rest = lines.slice(1).join("\n").trim();
  return rest.length > 0 ? rest : null;
}

/** Matches `formatApprovalRelayMarkdown` shell relay body (`packages/shared` approval-scope). */
function parseRelayShellBody(body: string): { cwd: string; commandLine: string } | null {
  const cwdMatch = body.match(/^Cwd:\s*(.+)$/m);
  const cmdMatch = body.match(/^Command:\s*(.+)$/m);
  const cwd = cwdMatch?.[1]?.trim();
  const commandLine = cmdMatch?.[1]?.trim();
  if (!cwd || !commandLine) return null;
  return { cwd, commandLine };
}

function parseFilesystemActionFromRelayLabel(label: string): "read" | "write" | null {
  const m = label.match(/Filesystem\s+(read|write)\b/i);
  if (!m) return null;
  return m[1].toLowerCase() === "read" ? "read" : "write";
}

function parseRelayFilesystemBody(
  body: string,
  label: string,
): { action: "read" | "write"; resourcePath: string; meta?: string; body?: string } | null {
  const action = parseFilesystemActionFromRelayLabel(label);
  if (!action) return null;
  const lines = body.split("\n");
  let resourcePath: string | undefined;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]?.trimEnd() ?? "";
    if (line.startsWith("Path: ")) {
      resourcePath = line.slice(6).trim();
      break;
    }
  }
  if (!resourcePath) return null;
  i += 1;
  let meta: string | undefined;
  if (lines[i]?.trimStart().startsWith("Window: ")) {
    meta = lines[i].replace(/^\s*Window:\s*/, "").trim();
    i += 1;
  }
  let patchBody: string | undefined;
  const patchHeader = lines[i]?.trim();
  if (patchHeader === "Patch:" || patchHeader?.startsWith("Patch:")) {
    patchBody = lines.slice(i + 1).join("\n").trim();
    if (patchBody.length === 0) patchBody = undefined;
  }
  return { action, resourcePath, meta, body: patchBody };
}

type ArtifactViewMode = "preview" | "markdown";

function ArtifactViewToggle({
  mode,
  onChange,
}: {
  mode: ArtifactViewMode;
  onChange: (next: ArtifactViewMode) => void;
}) {
  const options: { id: ArtifactViewMode; label: string }[] = [
    { id: "preview", label: "Preview" },
    { id: "markdown", label: "Markdown" },
  ];
  return (
    <div className="flex items-center gap-1 text-[10px] font-mono leading-none text-zinc-500 dark:text-zinc-400">
      {options.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`rounded-md px-2 py-1 transition-colors ${
            mode === id
              ? "bg-foreground/[0.06] text-foreground dark:bg-white/10 dark:text-zinc-50"
              : "hover:bg-foreground/[0.03] hover:text-foreground dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// The artifact card + modal are always dark surfaces, but <Markdown> colors are
// theme-aware (text-foreground → dark in a light app), so tables/pre/links
// rendered dark-on-dark. Force a complete light-on-dark scheme for every element.
const ARTIFACT_MD_CLASS = [
  "text-zinc-100",
  "[&_a]:text-violet-300 [&_a]:underline [&_a]:underline-offset-2",
  "[&_blockquote]:border-zinc-700 [&_blockquote]:text-zinc-400",
  "[&_code]:text-zinc-200",
  "[&_pre]:bg-white/5 [&_pre]:text-zinc-200 [&_pre]:rounded-lg [&_pre]:p-3",
  "[&_h1]:mt-1 [&_h1]:mb-4 [&_h1]:text-[2.15rem] [&_h1]:font-semibold [&_h1]:tracking-[-0.05em] [&_h1]:leading-[1.03] [&_h1]:text-white",
  "[&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-[1.65rem] [&_h2]:font-semibold [&_h2]:tracking-[-0.04em] [&_h2]:leading-tight [&_h2]:text-white",
  "[&_h3]:text-white [&_h4]:text-zinc-100 [&_h5]:text-zinc-200 [&_h6]:text-zinc-400",
  "[&_li]:my-0.5 [&_li]:text-[0.96rem] [&_li]:leading-7 [&_li]:text-zinc-300",
  "[&_p]:my-0 [&_p]:text-[0.96rem] [&_p]:leading-7 [&_p]:text-zinc-300",
  "[&_strong]:text-white",
  "[&_table]:text-zinc-300 [&_th]:text-white [&_th]:border-white/15 [&_td]:text-zinc-300 [&_td]:border-white/10",
  "[&_hr]:border-white/10",
  "[&_ul]:mt-3 [&_ul]:space-y-2 [&_ul]:pl-6",
].join(" ");

function ArtifactFilePreview({ artifact }: { artifact: ArtifactFileView }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(540);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const isHtml = artifact.artifactFormat === "html";

  const diff = artifact.diff;
  const [viewMode, setViewMode] = useState<ArtifactViewMode>("preview");

  const measureIframeHeight = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      const nextHeight = Math.max(
        doc?.documentElement?.scrollHeight ?? 0,
        doc?.body?.scrollHeight ?? 0,
        540,
      );
      setIframeHeight(nextHeight);
    } catch {
      setIframeHeight(540);
    }
  }, []);

  useEffect(() => {
    if (!isHtml) return;
    measureIframeHeight();
  }, [artifact.content, isHtml, measureIframeHeight]);

  const copyArtifact = useCallback(() => {
    navigator.clipboard.writeText(artifact.content).then(() => {
      setCopied(true);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 1400);
    }).catch(() => undefined);
  }, [artifact.content]);

  const downloadArtifact = useCallback(() => {
    const blob = new Blob([artifact.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifact.name || "artifact.txt";
    link.click();
    URL.revokeObjectURL(url);
  }, [artifact.content, artifact.name]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  return (
    <>
      <div className="mt-2 overflow-hidden rounded-[24px] border border-white/10 bg-[#1b1b1b] shadow-[0_24px_80px_rgba(0,0,0,0.32)] ring-1 ring-white/5">
        <div className="flex items-center justify-between gap-3 px-5 pt-3">
          <div className="flex min-w-0 items-center gap-2 text-zinc-400">
            <ListTodo className="h-4 w-4 shrink-0" />
            <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-zinc-400">
              {artifact.name}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-zinc-400">
            {diff ? <ArtifactViewToggle mode={viewMode} onChange={setViewMode} /> : null}
            <button
              type="button"
              onClick={downloadArtifact}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/5 hover:text-zinc-200"
              title="Download artifact"
              aria-label="Download artifact"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={copyArtifact}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                copied
                  ? "text-zinc-100"
                  : "hover:bg-white/5 hover:text-zinc-200"
              }`}
              title="Copy artifact"
              aria-label="Copy artifact"
            >
              {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/5 hover:text-zinc-200"
              title="Open in modal"
              aria-label="Open in modal"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="relative px-5 pb-5 pt-2">
          {viewMode === "markdown" && diff ? (
            <div className={isExpanded ? "" : "max-h-[540px] overflow-hidden"}>
              <div className="animate-in fade-in-50 duration-200 rounded-[20px] bg-[#111111] px-0 py-0 text-zinc-100">
                <UnifiedDiffView text={diff} />
              </div>
            </div>
          ) : isHtml ? (
            <iframe
              ref={iframeRef}
              title={artifact.name}
              sandbox=""
              srcDoc={artifact.content}
              onLoad={measureIframeHeight}
              className={`w-full border-0 bg-transparent ${isExpanded ? "" : "pointer-events-none"}`}
              style={{ height: isExpanded ? iframeHeight : 540 }}
            />
          ) : (
            <div className={isExpanded ? "" : "max-h-[540px] overflow-hidden"}>
              <div className={ARTIFACT_MD_CLASS}>
                <Markdown content={artifact.content} />
              </div>
            </div>
          )}
          {!isExpanded ? (
            <>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#1b1b1b] via-[#1b1b1b]/90 to-transparent" />
              <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center">
                <button
                  type="button"
                  onClick={() => setIsExpanded(true)}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-semibold text-zinc-100 shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  See more
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        contentClassName="max-w-6xl p-0 border-0 shadow-none !bg-[#232323]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.04] px-5 py-3 text-zinc-400">
          <div className="flex min-w-0 items-center gap-2">
            <ListTodo className="h-4 w-4 shrink-0" />
            <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-zinc-300">
              {artifact.name}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-zinc-400">
            {diff ? <ArtifactViewToggle mode={viewMode} onChange={setViewMode} /> : null}
            <button
              type="button"
              onClick={downloadArtifact}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/5 hover:text-zinc-200"
              title="Download artifact"
              aria-label="Download artifact"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={copyArtifact}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                copied ? "text-zinc-100" : "hover:bg-white/5 hover:text-zinc-200"
              }`}
              title="Copy artifact"
              aria-label="Copy artifact"
            >
              {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-white/5 hover:text-zinc-200"
              title="Close"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="px-5 pb-5 pt-2">
          {viewMode === "markdown" && diff ? (
            <div className="max-h-[calc(100vh-12rem)] overflow-auto text-zinc-100">
              <UnifiedDiffView text={diff} />
            </div>
          ) : isHtml ? (
            <div className="max-h-[calc(100vh-12rem)] overflow-auto">
              <iframe
                title={artifact.name}
                sandbox=""
                srcDoc={artifact.content}
                className="w-full border-0 bg-transparent"
                style={{ height: iframeHeight }}
              />
            </div>
          ) : (
            <div className={`max-h-[calc(100vh-12rem)] overflow-auto ${ARTIFACT_MD_CLASS}`}>
              <Markdown content={artifact.content} />
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

export const ChatMessageList = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    onScroll?: UIEventHandler<HTMLDivElement>;
    className?: string;
  }
>(function ChatMessageList({ children, onScroll, className = "" }, ref) {
  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className={`h-full min-h-0 overflow-y-auto px-4 py-4 ${className}`}
    >
      {children}
    </div>
  );
});
