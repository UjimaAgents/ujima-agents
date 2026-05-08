import { useCallback, useRef, useState, forwardRef, type MouseEvent, type ReactNode, type UIEventHandler } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { type AttachmentCategory } from "@ujima/shared";
import { Avatar, TagBadge, type TagVariant } from "./primitives";
import { MessageActions } from "../message-actions";
import { Markdown, MarkdownInline } from "../markdown";
import { AttachmentGrid } from "./attachment-grid";

export interface ChatMessageData {
  id: string;
  senderId?: string;
  parentMessageId?: string;
  role: string;
  name: string;
  time: string;
  content: string;
  createdAt?: string;
  mentionNames?: string[];
  attachments?: {
    id: string;
    filename: string;
    mimeType: string;
    category: AttachmentCategory;
    sizeBytes: number;
  }[];
  replyPreview?: {
    name: string;
    content: string;
  };
  detail?: string;
  tag?: { label: string; variant: TagVariant };
  status?: "success" | "warning";
  pending?: boolean;
}

const DRAG_THRESHOLD = 30;

export function ChatMessage({
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

  return (
    <>
      <div
        onClick={onClick}
        onContextMenu={handleContextMenu}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`relative group flex gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer select-none ${
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
          {message.replyPreview && (
            <div className="mt-1 rounded-md border-l-2 border-zinc-300 bg-zinc-100/70 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900/70">
              <p className="truncate text-[10px] font-semibold text-zinc-700 dark:text-zinc-300">
                Replying to {message.replyPreview.name}
              </p>
              <MarkdownInline
                content={message.replyPreview.content}
                className="block truncate text-[10px] text-zinc-500 dark:text-zinc-400"
              />
            </div>
          )}
          <Markdown
            content={message.content}
            mentionNames={message.mentionNames}
          />
          <AttachmentGrid
            attachments={message.attachments}
            organizationId={organizationId ?? ""}
          />
          {message.detail && (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {message.detail}
            </p>
          )}
          {message.pending && (
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Sending
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
