import { forwardRef, type ReactNode, type UIEventHandler } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Avatar, TagBadge, type TagVariant } from "./primitives";

const MENTION_RE = /(^|[^@\w])@([A-Za-z0-9][A-Za-z0-9._-]*)/g;

export interface ChatMessageData {
  id: string;
  senderId?: string;
  role: string;
  name: string;
  time: string;
  content: string;
  createdAt?: string;
  detail?: string;
  tag?: { label: string; variant: TagVariant };
  status?: "success" | "warning";
  pending?: boolean;
}

export function ChatMessage({
  message,
  active,
  onClick,
  colorIndex = 0,
}: {
  message: ChatMessageData;
  active?: boolean;
  onClick?: () => void;
  colorIndex?: number;
}) {
  return (
    <div
      onClick={onClick}
      className={`relative group flex gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer ${
        active
          ? "bg-violet-50/50 ring-1 ring-violet-200 dark:bg-violet-500/5 dark:ring-violet-500/20"
          : "hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
      } ${message.pending ? "opacity-70" : ""}`}
    >
      <Avatar name={message.name} colorIndex={colorIndex} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-bold text-zinc-900 dark:text-white">
            {message.name}
          </p>
          <p className="text-[10px] text-zinc-400">{message.time}</p>
          {message.tag && (
            <TagBadge variant={message.tag.variant} label={message.tag.label} />
          )}
        </div>
        <p className="mt-0.5 text-xs font-normal leading-relaxed whitespace-pre-wrap text-zinc-900 dark:text-white">
          {renderMessageContent(message.content)}
        </p>
        {message.detail && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {message.detail}
          </p>
        )}
        {message.pending && (
          <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Sending…
          </div>
        )}
      </div>
      {active && (
        <div className="absolute -left-0.5 top-1/2 -translate-y-1/2 h-8 w-0.5 rounded-full bg-violet-600" />
      )}
      {message.status === "success" && (
        <CheckCircle2 className="absolute right-3 top-3 h-4 w-4 text-emerald-500" />
      )}
    </div>
  );
}

function renderMessageContent(content: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(MENTION_RE)) {
    const index = match.index ?? 0;
    const prefix = match[1] ?? "";
    const handle = match[2] ?? "";
    const mentionStart = index + prefix.length;
    const mentionEnd = mentionStart + 1 + handle.length;

    if (index > lastIndex) {
      nodes.push(<span key={`text-${index}`}>{content.slice(lastIndex, index)}</span>);
    }
    if (prefix) {
      nodes.push(<span key={`prefix-${index}`}>{prefix}</span>);
    }
    nodes.push(
      <span key={`mention-${index}`} className="font-semibold text-zinc-900 dark:text-white">
        @{handle}
      </span>,
    );
    lastIndex = mentionEnd;
  }

  if (lastIndex < content.length) {
    nodes.push(<span key={`tail-${lastIndex}`}>{content.slice(lastIndex)}</span>);
  }

  return nodes.length > 0 ? nodes : content;
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
      className={`h-full min-h-0 overflow-y-auto px-4 py-4 space-y-2 ${className}`}
    >
      {children}
    </div>
  );
});
