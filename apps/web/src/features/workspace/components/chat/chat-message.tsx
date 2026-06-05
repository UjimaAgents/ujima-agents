import { memo, useCallback, useEffect, useRef, useState, forwardRef, type MouseEvent, type ReactNode, type UIEventHandler } from "react";
import { CheckCircle2, ChevronDown, Copy, Loader2, Maximize2, Sparkles } from "lucide-react";
import { type AttachmentCategory } from "@ujima/shared/browser";
import { Avatar, TagBadge, type TagVariant } from "./primitives";
import { MessageActions } from "../message-actions";
import { Markdown, MarkdownInline } from "../markdown";
import { AttachmentGrid } from "./attachment-grid";
import { TerminalPane } from "./terminal-pane";
import { FilesystemToolPane } from "./filesystem-tool-pane";
import { TokenCount } from "./chat-token-count";
import { Modal } from "@/components/ui/modal";
import { UnifiedDiffView } from "./unified-diff-view";

const CONVERSATION_ARCHIVE_MARKER = "[[CONVERSATION_ARCHIVE_V1]]";
const CONVERSATION_SUMMARY_MARKER = "[[CONVERSATION_SUMMARY_V1]]";
const SELF_NOTE_SUMMARY_MARKER = "[[SELF_NOTE_SUMMARY_V1]]";

export interface ChatMessageData {
  id: string;
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
  tag?: { label: string; variant: TagVariant };
  status?: "success" | "warning";
  pending?: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

const DRAG_THRESHOLD = 30;

export const ChatMessage = memo(function ChatMessage({
  message,
  active,
  onClick,
  colorIndex = 0,
  onReply,
  organizationId,
}: {
  message: ChatMessageData;
  active?: boolean;
  onClick?: () => void;
  colorIndex?: number;
  onReply?: (message: ChatMessageData) => void;
  organizationId?: string;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);

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
  const showBody = message.content.trim().length > 0 && !(artifactFile && isInternalMarkerContent(message.content));

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`relative group animate-in flex gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer select-none ${
          message.kind === "system" ? "items-center" : "items-start"
        } ${
          active
            ? "bg-violet-50/50 ring-1 ring-violet-200 dark:bg-violet-500/5 dark:ring-violet-500/20"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
        } ${message.status === "success" ? "pr-8" : ""} ${message.pending ? "opacity-70" : ""}`}
      >
        {message.kind === "system" ? (
          <>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <p className="min-w-0 max-w-full truncate text-sm font-bold text-zinc-900 dark:text-white">
                  {systemLabel}
                </p>
                <p className="shrink-0 text-[11px] text-zinc-400">{message.time}</p>
              </div>
              {artifactFile ? <ArtifactFilePreview artifact={artifactFile} /> : null}
              {approvalShellTerminal ? (
                <TerminalPane
                  className="mt-1.5"
                  cwd={approvalShellTerminal.cwd}
                  commandLine={approvalShellTerminal.commandLine}
                />
              ) : approvalFsTerminal ? (
                <FilesystemToolPane
                  className="mt-1.5"
                  action={approvalFsTerminal.action}
                  resourcePath={approvalFsTerminal.resourcePath}
                  meta={approvalFsTerminal.meta}
                  body={approvalFsTerminal.body}
                />
              ) : systemBodyMarkdown !== null ? (
                <div className={artifactFile ? "mt-3" : "mt-1"}>
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
              <div className={artifactFile ? "mt-3" : "mt-1"}>
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
        {active && (
          <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 h-8 w-0.5 rounded-full bg-violet-600" />
        )}
        {message.status === "success" && (
          <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-emerald-500" />
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

function getSystemMessageLabel(content: string): string {
  if (content.startsWith(CONVERSATION_ARCHIVE_MARKER)) return "Conversation archived";
  if (content.startsWith(CONVERSATION_SUMMARY_MARKER)) return "Conversation compacted";
  if (content.startsWith(SELF_NOTE_SUMMARY_MARKER)) return "Self notes compacted";
  if (content.startsWith("[Approval needed]")) {
    const firstLine = content.split("\n")[0]?.trim() ?? "";
    return firstLine.length > 0 ? firstLine : "Approval needed";
  }
  return "System summary";
}

function isInternalMarkerContent(content: string): boolean {
  return (
    content.startsWith(CONVERSATION_ARCHIVE_MARKER) ||
    content.startsWith(CONVERSATION_SUMMARY_MARKER) ||
    content.startsWith(SELF_NOTE_SUMMARY_MARKER)
  );
}

/** Body below the title line for system messages that carry multi-line context (e.g. approval relay). */
function systemMessageBodyMarkdown(content: string): string | null {
  if (content.startsWith("[Approval needed]")) {
    const rest = content.split("\n").slice(1).join("\n").trim();
    return rest.length > 0 ? rest : null;
  }
  return null;
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

interface ArtifactFileView {
  name: string;
  filePath: string;
  content: string;
  diff?: string;
  artifactFormat: "html" | "markdown";
  status: string;
}

function formatArtifactStatus(status: string): string {
  return status
    .trim()
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getArtifactFileCard(toolCalls?: ChatMessageData["toolCalls"]): ArtifactFileView | null {
  const card = toolCalls?.find(
    (entry) => entry.toolName === "card.artifact.file" || entry.toolName === "card.goal.file",
  );
  if (!card) return null;
  const name = stringArg(card.args, "name") ?? stringArg(card.args, "goalName");
  const filePath = stringArg(card.args, "filePath") ?? stringArg(card.args, "goalFilePath");
  const html = stringArg(card.args, "html");
  const diff = stringArg(card.args, "diff");
  const artifactFormat = card.args.artifactFormat;
  const status = stringArg(card.args, "status");
  if (!name || !filePath || !html || !status) return null;
  return {
    name,
    filePath,
    content: html,
    diff,
    artifactFormat: artifactFormat === "html" ? "html" : "markdown",
    status,
  };
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
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

function ArtifactFilePreview({ artifact }: { artifact: ArtifactFileView }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [iframeHeight, setIframeHeight] = useState(540);
  const [copied, setCopied] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const isHtml = artifact.artifactFormat === "html";

  const diff = artifact.diff;
  const [viewMode, setViewMode] = useState<ArtifactViewMode>(diff ? "markdown" : "preview");
  const [lastDiff, setLastDiff] = useState(diff);
  if (lastDiff !== diff) {
    setLastDiff(diff);
    setViewMode(diff ? "markdown" : "preview");
  }

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

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  return (
    <>
      <div className="mt-3 overflow-hidden rounded-xl bg-zinc-50/70 shadow-sm ring-1 ring-zinc-200/50 dark:bg-zinc-900/30 dark:ring-zinc-800/60">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200/60 px-3 py-2 dark:border-zinc-800/60">
          <div className="min-w-0">
            <p className="truncate text-[11px] leading-none text-zinc-400 dark:text-zinc-500">
              {artifact.filePath}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {diff && <ArtifactViewToggle mode={viewMode} onChange={setViewMode} />}
            <span className="rounded-full bg-violet-100/80 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
              {formatArtifactStatus(artifact.status)}
            </span>
            <button
              type="button"
              onClick={copyArtifact}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                copied
                  ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              }`}
              title="Copy artifact"
              aria-label="Copy artifact"
            >
              {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title="Open in modal"
              aria-label="Open in modal"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="relative">
          {viewMode === "markdown" && diff ? (
            <div className={isExpanded ? "" : "max-h-[540px] overflow-hidden"}>
              <div className="px-4 py-3 bg-zinc-950 text-zinc-50 dark:bg-zinc-950/80 animate-in fade-in-50 duration-200">
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
              <div className="px-4 py-3">
                <Markdown content={artifact.content} />
              </div>
            </div>
          )}
          {!isExpanded ? (
            <>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-zinc-50 via-zinc-50/80 to-transparent dark:from-zinc-900 dark:via-zinc-900/80" />
              <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center">
                <button
                  type="button"
                  onClick={() => setIsExpanded(true)}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-zinc-950/90 px-3 py-1.5 text-[10px] font-semibold text-white shadow-lg shadow-black/20 backdrop-blur-md transition hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-violet-400/70 dark:border-white/10 dark:bg-zinc-950/90 dark:text-white"
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
        title={artifact.name}
        contentClassName="max-w-6xl"
      >
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                {artifact.filePath}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {diff && <ArtifactViewToggle mode={viewMode} onChange={setViewMode} />}
              <span className="rounded-full bg-violet-100/80 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                {formatArtifactStatus(artifact.status)}
              </span>
              <button
                type="button"
                onClick={copyArtifact}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                  copied
                    ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                    : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                }`}
                title="Copy artifact"
                aria-label="Copy artifact"
              >
                {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200/60 dark:ring-zinc-800/70">
            {viewMode === "markdown" && diff ? (
              <div className="max-h-[calc(100vh-12rem)] overflow-auto px-4 py-3 bg-zinc-950 text-zinc-50 dark:bg-zinc-950/80">
                <UnifiedDiffView text={diff} />
              </div>
            ) : isHtml ? (
              <div className="max-h-[calc(100vh-12rem)] overflow-auto">
                <iframe
                  title={artifact.name}
                  sandbox=""
                  srcDoc={artifact.content}
                  className="w-full border-0 bg-white dark:bg-zinc-950"
                  style={{ height: iframeHeight }}
                />
              </div>
            ) : (
              <div className="max-h-[calc(100vh-12rem)] overflow-auto px-4 py-3">
                <Markdown content={artifact.content} />
              </div>
            )}
          </div>
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
