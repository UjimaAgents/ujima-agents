"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { MoreHorizontal, SquarePen, Type } from "lucide-react";
import type { BootstrapResponse } from "@ujima/api-schema";
import type {
  Member,
  ShellApprovalMode,
} from "@ujima/shared/browser";
import type { ChatFontSize } from "../../workspace-store";
import { AgentChatHeaderControls } from "./agent-chat-header-controls";
import { ChannelChatHeaderControls } from "./channel-chat-header-controls";
import { FontSizeControl } from "./font-size-control";

const SIZE_OPTIONS: { value: ChatFontSize; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "X-Large" },
  { value: "xxlarge", label: "2X Large" },
  { value: "3xlarge", label: "3X Large" },
  { value: "6xlarge", label: "6X Large" },
];

/* ── Agent DM header props ─────────────────────────────────────────── */

interface AgentHeaderProps {
  kind: "agent";
  orgId: string;
  agentMember: Member;
  providers: BootstrapResponse["providers"];
  orgShellApprovalMode: ShellApprovalMode;
  goalMode: boolean;
  onMemberUpdated: (member: Member) => void;
  onOpenAgentEditor?: () => void;
}

/* ── Channel header props ──────────────────────────────────────────── */

interface ChannelHeaderProps {
  kind: "channel";
  channelValue: ShellApprovalMode;
  onChannelChange: (value: ShellApprovalMode) => Promise<void> | void;
}

/* ── Shared ────────────────────────────────────────────────────────── */

interface SharedHeaderProps {
  chatFontSize: ChatFontSize;
  onChatFontSizeChange: (size: ChatFontSize) => void;
}

type Props = SharedHeaderProps & (AgentHeaderProps | ChannelHeaderProps);

/* ── Collapsible header actions ────────────────────────────────────── */

const COLLAPSE_THRESHOLD = 420; // px — below this, items collapse into a menu

export function CollapsibleHeaderActions(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Measure available width vs threshold */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const check = () => {
      setCollapsed(el.clientWidth < COLLAPSE_THRESHOLD);
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* Close menu on outside click */
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  /* ── Full inline layout (wide enough) ── */

  if (!collapsed) {
    return (
      <div ref={containerRef} className="flex items-center gap-2">
        <FontSizeControl value={props.chatFontSize} onChange={props.onChatFontSizeChange} />
        {props.kind === "agent" ? (
          <>
            <AgentChatHeaderControls
              orgId={props.orgId}
              member={props.agentMember}
              providers={props.providers}
              orgShellApprovalMode={props.orgShellApprovalMode}
              goalMode={props.goalMode}
              onMemberUpdated={props.onMemberUpdated}
            />
            {props.onOpenAgentEditor ? (
              <button
                type="button"
                onClick={props.onOpenAgentEditor}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <SquarePen className="h-3.5 w-3.5" />
                Edit
              </button>
            ) : null}
          </>
        ) : (
          <ChannelChatHeaderControls
            value={props.channelValue}
            onChange={props.onChannelChange}
          />
        )}
      </div>
    );
  }

  /* ── Collapsed: all items in a three-dot dropdown menu ── */

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        aria-label="More header options"
        title="More options"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>

      {menuOpen && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-40"
            onClick={closeMenu}
          />

          <div
            ref={menuRef}
            className="absolute right-0 top-full z-50 mt-1 min-w-[280px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg shadow-black/5 dark:border-zinc-700 dark:bg-zinc-900 animate-in fade-in slide-in-from-top-1 duration-150"
          >
            {/* Font size sub-menu */}
            <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                <Type className="h-3 w-3" />
                Font size
              </div>
              <div className="space-y-0.5">
                {SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      props.onChatFontSizeChange(opt.value);
                      closeMenu();
                    }}
                    className={`flex w-full items-center rounded px-2 py-1 text-[11px] font-semibold transition hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                      props.chatFontSize === opt.value
                        ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                        : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {opt.label}
                    {props.chatFontSize === opt.value && (
                      <span className="ml-auto text-[10px] text-violet-500">✓</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Agent DM controls */}
            {props.kind === "agent" && (
              <div className="space-y-2 px-3 py-2">
                {props.goalMode ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                    Goal mode · Auto review
                  </div>
                ) : (
                  <CompactShellApproval
                    kind={props.kind}
                  />
                )}

                {props.onOpenAgentEditor ? (
                  <button
                    type="button"
                    onClick={() => {
                      props.onOpenAgentEditor?.();
                      closeMenu();
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    <SquarePen className="h-3.5 w-3.5" />
                    Edit agent
                  </button>
                ) : null}
              </div>
            )}

            {/* Channel controls */}
            {props.kind === "channel" && (
              <div className="px-3 py-2">
                <CompactShellApproval
                  kind={props.kind}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Compact inline shell-approval selector for the dropdown menu ── */

function CompactShellApproval({ kind }: { kind: "agent" | "channel" }) {
  // This is rendered inside the dropdown via ChannelChatHeaderControls / ShellApprovalMemberModeField
  // But since those components need all their props, we let the full components handle it
  // For the collapsed dropdown we just show a placeholder label linking to the full mode
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      {kind === "agent" ? "Shell approval · Inherit" : "Shell approval · Never approve"}
    </div>
  );
}
