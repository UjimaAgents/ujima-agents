import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { MarkdownInline } from "../markdown";
import { shellInvocationDisplayLine, type ParsedFilesystemScope } from "@ujima/shared/browser";
import { FilesystemToolPane } from "./filesystem-tool-pane";
import { TerminalPane } from "./terminal-pane";

export interface ApprovalCardData {
  id: string;
  runId?: string;
  /** Conversation thread that produced this approval (when known). */
  threadId?: string;
  /** Member id of the agent that requested approval (stable id for filtering). */
  requestedByMemberId?: string;
  title: string;
  description: string;
  /** Human-readable shell line + cwd when applicable */
  commandPreview?: string;
  shellScope?: {
    cwd: string;
    command: string;
    args?: string[];
  };
  filesystemScope?: ParsedFilesystemScope;
  status: "pending" | "approved" | "rejected";
  /** Display name for the requesting agent */
  requestedBy: string;
  createdAt?: string;
  approvalsNeeded: number;
  reviewers?: { color: string }[];
}

/** Indent to align with body text past the shield icon (w-8 + gap-3). */
const BODY_INDENT = "pl-11";

export function ApprovalCard({
  data,
  resolving,
  onResolve,
}: {
  data: ApprovalCardData;
  resolving?: boolean;
  onResolve?: (resolution: "allow_once" | "allow_always" | "allow_family" | "reject") => void;
}) {
  const isPending = data.status === "pending";
  const [allowMenuOpen, setAllowMenuOpen] = useState(false);
  const [allowMenuPlacement, setAllowMenuPlacement] = useState<"up" | "down">("up");
  const allowMenuRef = useRef<HTMLDivElement>(null);
  const allowMenuButtonRef = useRef<HTMLButtonElement>(null);
  const allowMenuListRef = useRef<HTMLDivElement>(null);
  const statusLabel =
    data.status === "approved"
      ? "Approved"
      : data.status === "rejected"
        ? "Rejected"
        : "Pending";
  const statusTone =
    data.status === "approved"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : data.status === "rejected"
        ? "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300"
        : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";

  useEffect(() => {
    if (!allowMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (allowMenuRef.current?.contains(event.target as Node)) return;
      setAllowMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAllowMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [allowMenuOpen]);

  useLayoutEffect(() => {
    if (!allowMenuOpen) return;
    const updatePlacement = () => {
      const button = allowMenuButtonRef.current;
      const menu = allowMenuListRef.current;
      if (!button || !menu) return;

      const menuHeight = menu.offsetHeight;
      const spaceAbove = button.getBoundingClientRect().top;
      const spaceBelow = window.innerHeight - button.getBoundingClientRect().bottom;
      setAllowMenuPlacement(spaceAbove >= menuHeight + 8 || spaceAbove >= spaceBelow ? "up" : "down");
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [allowMenuOpen]);

  function resolveApproval(resolution: "allow_once" | "allow_always" | "allow_family" | "reject") {
    setAllowMenuOpen(false);
    onResolve?.(resolution);
  }

  return (
    <div
      key={data.id}
      className="animate-approval-in rounded-xl border border-zinc-200 bg-zinc-50/90 px-4 py-3 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60"
    >
      <div className="flex gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-violet-50 dark:border-violet-500/20 dark:bg-violet-500/10">
          <ShieldAlert className="h-4 w-4 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">{data.title}</p>
            {data.reviewers && data.reviewers.length > 0 ? (
              <div className="flex shrink-0 items-center -space-x-1">
                {data.reviewers.map((r, i) => (
                  <div
                    key={i}
                    className={`h-5 w-5 rounded-full ${r.color} border-2 border-white dark:border-zinc-900`}
                  />
                ))}
              </div>
            ) : null}
          </div>
          {data.description ? (
            <MarkdownInline
              content={data.description}
              className="mt-0.5 block text-[10px] text-zinc-500 dark:text-zinc-400"
            />
          ) : null}
          {data.shellScope ? (
            <TerminalPane
              className="mt-2"
              cwd={data.shellScope.cwd}
              commandLine={shellInvocationDisplayLine(data.shellScope)}
            />
          ) : data.filesystemScope ? (
            <FilesystemToolPane
              className="mt-2"
              action={data.filesystemScope.action}
              resourcePath={data.filesystemScope.resourcePath}
              body={
                data.filesystemScope.action === "write"
                  ? (data.filesystemScope.patch ?? data.filesystemScope.content)
                  : undefined
              }
            />
          ) : data.commandPreview ? (
            <pre className="mt-1.5 max-h-28 overflow-y-auto rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[10px] font-mono leading-relaxed whitespace-pre-wrap text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
              {data.commandPreview}
            </pre>
          ) : null}
        </div>
      </div>

      {isPending ? (
        <div className={`mt-3 flex flex-wrap items-center justify-end gap-2 ${BODY_INDENT}`}>
          <button
            type="button"
            disabled={resolving}
            onClick={() => resolveApproval("reject")}
            className="rounded-md border border-zinc-200 bg-transparent px-3 py-1.5 text-[10px] text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Reject
          </button>
          <div ref={allowMenuRef} className="relative">
            <button
              ref={allowMenuButtonRef}
              type="button"
              disabled={resolving}
              onClick={() => setAllowMenuOpen((value) => !value)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[10px] text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Allow
              <ChevronDown className="h-3 w-3" aria-hidden />
            </button>
            {allowMenuOpen ? (
              <div
                ref={allowMenuListRef}
                className={`absolute right-0 z-10 w-32 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 ${
                  allowMenuPlacement === "up" ? "bottom-full mb-1" : "top-full mt-1"
                }`}
              >
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => resolveApproval("allow_once")}
                  className="block w-full px-3 py-2 text-left text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Once
                </button>
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => resolveApproval("allow_always")}
                  className="block w-full px-3 py-2 text-left text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Always
                </button>
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => resolveApproval("allow_family")}
                  className="block w-full px-3 py-2 text-left text-[10px] text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-900"
                >
                  Family
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={`mt-3 flex justify-end ${BODY_INDENT}`}>
          <span className={`rounded-md border px-3 py-1.5 text-[10px] font-semibold shadow-sm ${statusTone}`}>
            {statusLabel}
          </span>
        </div>
      )}
    </div>
  );
}
