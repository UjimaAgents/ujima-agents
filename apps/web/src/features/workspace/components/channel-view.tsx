"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { DragHandle } from "./workspace-shell";
import {
  ChatHeader,
  ChatTabs,
  ChatMessageList,
  ChatInput,
  DetailsSidebar,
  type ChatTab,
} from "./chat";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation } from "../types";

/* ── Tab config (reusable) ─────────────────────────────────────────── */
const CHANNEL_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "approvals", label: "Approvals" },
  { id: "files", label: "Files Changed" },
  { id: "activity", label: "Activity" },
];

const AGENT_TABS: ChatTab[] = [
  { id: "conversation", label: "Conversation" },
  { id: "tasks", label: "Tasks" },
  { id: "activity", label: "Activity" },
];

/* ── Empty state ───────────────────────────────────────────────────── */
function EmptyChat({ conversation }: { conversation: SelectedConversation }) {
  const isAgent = conversation.type === "agent";
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
        <MessageSquare className="h-7 w-7 text-zinc-400" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-zinc-900 dark:text-white">
        {isAgent
          ? `Start a conversation with ${conversation.name}`
          : `Welcome to #${conversation.name}`}
      </h3>
      <p className="mt-1 text-xs text-zinc-500 max-w-xs text-center">
        {isAgent
          ? "Send a message or assign a task to get started."
          : "This is the beginning of the channel. Send a message to start collaborating."}
      </p>
    </div>
  );
}

/* ── ChannelView ───────────────────────────────────────────────────── */
interface ChannelViewProps {
  bootstrap: BootstrapResponse;
  conversation: SelectedConversation;
}

export function ChannelView({ bootstrap, conversation }: ChannelViewProps) {
  const [activeTab, setActiveTab] = useState("conversation");
  const [showDetails, setShowDetails] = useState(false);
  const [detailsWidth, setDetailsWidth] = useState(25);
  const [detailsTab, setDetailsTab] = useState("Reasoning trace");

  const isAgent = conversation.type === "agent";
  const tabs = isAgent ? AGENT_TABS : CHANNEL_TABS;

  return (
    <div className="flex flex-1 overflow-hidden bg-white dark:bg-[#09090b]">
      {/* Main chat column */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChatHeader
          title={conversation.name}
          type={conversation.type === "agent" ? "dm" : "channel"}
          status={conversation.type === "agent" ? "active" : "active"}
          statusLabel={conversation.type === "agent" ? "online" : "Active"}
          members={bootstrap.members}
        />
        <ChatTabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
        <ChatMessageList>
          <EmptyChat conversation={conversation} />
        </ChatMessageList>
        <ChatInput
          placeholder={
            isAgent
              ? `Message @${conversation.name}...`
              : `Message #${conversation.name} or @agent...`
          }
        />
      </div>

      {/* Right details sidebar */}
      {showDetails && (
        <>
          <DragHandle side="right" onResize={setDetailsWidth} />
          <div
            style={{ width: `${detailsWidth}%`, minWidth: 280 }}
            className="shrink-0 h-full"
          >
            <DetailsSidebar
              agentName={conversation.name}
              agentColorIndex={1}
              statusLabel="online"
              timeLabel="—"
              tabs={["Reasoning trace", "Changes", "Metadata"]}
              activeTab={detailsTab}
              onTabChange={setDetailsTab}
              onClose={() => setShowDetails(false)}
            >
              <p className="text-xs text-zinc-500">No trace data yet.</p>
            </DetailsSidebar>
          </div>
        </>
      )}
    </div>
  );
}
