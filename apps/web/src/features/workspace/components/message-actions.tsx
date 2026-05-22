import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Reply, Copy } from "lucide-react";

export interface MessageActionsProps {
  x: number;
  y: number;
  messageContent: string;
  onReply: () => void;
  onClose: () => void;
}

export function MessageActions({
  x,
  y,
  messageContent,
  onReply,
  onClose,
}: MessageActionsProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const copy = () => {
    navigator.clipboard.writeText(messageContent).catch(() => {});
    onClose();
  };

  const menuWidth = 144;
  const menuHeight = 88;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  const menu = (
    <div
      ref={ref}
      className="fixed z-[200] min-w-36 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-950"
      style={{ left, top }}
    >
      <button
        type="button"
        onClick={() => {
          onReply();
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-violet-50 hover:text-violet-700 dark:text-zinc-300 dark:hover:bg-violet-500/10 dark:hover:text-violet-300"
      >
        <Reply className="h-3.5 w-3.5" />
        Reply
      </button>
      <button
        type="button"
        onClick={copy}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <Copy className="h-3.5 w-3.5" />
        Copy text
      </button>
    </div>
  );

  return createPortal(menu, document.body);
}
