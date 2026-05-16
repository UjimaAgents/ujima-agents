"use client";

import { Command, Hash, Plus, Search, Settings, ChevronDown } from "lucide-react";
import Link from "next/link";
import { Avatar } from "./chat/primitives";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation, WorkspaceRoleInput } from "../types";
import { useState, useMemo, memo } from "react";
import { TextInput } from "@/components/ui/form-fields";
import type { RolePresetTemplate } from "../../onboarding/types";
import { defaultModelForProvider } from "../../onboarding/types";
import { resolveMemberActivity } from "../workspace-store";
import type { ActivityState } from "../activity-state";
import { ThemeToggle } from "@/components/theme-toggle";
import { AgentEditorModal } from "./sidebar/agent-editor-modal";
import { CreateAgentModal } from "./sidebar/create-agent-modal";
import { CreateChannelModal } from "./sidebar/create-channel-modal";

export interface WorkspaceSidebarProps {
  bootstrap: BootstrapResponse;
  rolePresets: RolePresetTemplate[];
  teamSettings: {
    agents: { name: string; roleName: string; personalityName: string; kind: string }[];
    roles: {
      id?: string;
      name: string;
      title: string;
      description: string;
      instructions: string;
      kind: string;
      provider?: string;
      model?: string;
      workspaceScopes: string[];
      tools: string[];
      channels: string[];
      skills: string[];
    }[];
  } | null;
  goalMode: boolean;
  agentEditorTargetId?: string | null;
  onAgentEditorHandled?: () => void;
  channels: BootstrapResponse["channels"];
  members: BootstrapResponse["members"];
  memberActivity: Record<string, ActivityState>;
  conversationUnreadCounts: Record<string, number>;
  selected: SelectedConversation;
  onSelect: (conv: SelectedConversation) => void;
  onCreateChannel: (name: string) => Promise<SelectedConversation | null>;
  onCreateAgent: (input: {
    name: string;
    roleName: string;
    channelIds: string[];
    llm: string;
    model: string;
    role: WorkspaceRoleInput;
  }) => Promise<SelectedConversation | null>;
  onUpdateAgent: (input: {
    previousAgentId: string;
    previousRoleName: string;
    memberId: string;
    name: string;
    roleName: string;
    personalityName: string;
    channelIds: string[];
    llm: string;
    model: string;
    role: WorkspaceRoleInput;
  }) => Promise<BootstrapResponse["members"][number] | null>;
}

export function slugifyRoleName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function roleFromTemplate(template: RolePresetTemplate): WorkspaceRoleInput {
  return {
    id: template.name,
    name: template.name,
    title: template.title,
    description: template.description,
    instructions: template.instructions,
    kind: "agent",
    workspaceScopes: template.workspaceScopes ?? [],
    tools: template.tools ?? [],
    channels: ["general"],
    skills: template.skills ?? [],
  };
}

export function customRole(title: string, instructions: string): WorkspaceRoleInput {
  const name = slugifyRoleName(title) || "custom-agent";
  return {
    id: name,
    name,
    title: title.trim(),
    description: "",
    instructions: instructions.trim(),
    kind: "agent",
    workspaceScopes: [],
    tools: [],
    channels: ["general"],
    skills: [],
  };
}

export interface AgentEditorDraft {
  originalName: string;
  originalRoleName: string;
  memberId: string;
  name: string;
  roleName: string;
  personalityName: string;
  llm: string;
  model: string;
  title: string;
  description: string;
  instructions: string;
  workspaceScopes: string[];
  tools: string[];
  channels: string[];
  skills: string[];
}

export function buildAgentEditorDraft({
  agent,
  teamSettings,
  rolePresets,
  channels,
}: {
  agent: BootstrapResponse["members"][number];
  teamSettings: WorkspaceSidebarProps["teamSettings"];
  rolePresets: RolePresetTemplate[];
  channels: BootstrapResponse["channels"];
}) {
  const role =
    teamSettings?.roles.find((item) => item.name === agent.roleName) ??
    rolePresets.find((item) => item.name === agent.roleName);
  const provider = role && "provider" in role ? role.provider : undefined;
  const model = role && "model" in role ? role.model : undefined;
  const personalityName =
    teamSettings?.agents.find((item) => item.name === agent.id)?.personalityName ??
    "direct";

  return {
    originalName: agent.name,
    originalRoleName: agent.roleName,
    memberId: agent.id,
    name: agent.name,
    roleName: agent.roleName,
    personalityName,
    llm: agent.llm ?? provider ?? "openai",
    model:
      agent.model ??
      model ??
      defaultModelForProvider(agent.llm ?? provider ?? "openai"),
    title: role?.title ?? agent.roleName,
    description: role?.description ?? "",
    instructions: role?.instructions ?? "",
    workspaceScopes: role?.workspaceScopes ?? [],
    tools: role?.tools ?? [],
    channels: (role?.channels ?? ["general"])
      .map((channelName) => channels.find((channel) => channel.name === channelName)?.id)
      .filter((id): id is string => Boolean(id)),
    skills: role?.skills ?? [],
  } satisfies AgentEditorDraft;
}

export const PERSONALITY_OPTIONS = [
  { value: "direct", label: "Direct" },
  { value: "thoughtful", label: "Thoughtful" },
  { value: "precise", label: "Precise" },
  { value: "warm", label: "Warm" },
  { value: "skeptical", label: "Skeptical" },
  { value: "pragmatic", label: "Pragmatic" },
] as const;

export function listCsvValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinCsvValues(values: string[]) {
  return values.join(", ");
}

export function uniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function WorkspaceSidebar({
  bootstrap,
  rolePresets,
  teamSettings,
  goalMode,
  agentEditorTargetId,
  onAgentEditorHandled,
  channels,
  members,
  memberActivity,
  conversationUnreadCounts,
  selected,
  onSelect,
  onCreateChannel,
  onCreateAgent,
  onUpdateAgent,
}: WorkspaceSidebarProps) {
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const initialProvider =
    bootstrap.providers.find((provider) => provider.hasKey)?.name ?? "openai";

  const primaryChannel = useMemo(
    () =>
      channels.find(
        (channel) =>
          channel.name === "general" &&
          channel.kind !== "self" &&
          channel.kind !== "dm",
      ) ??
      channels.find(
        (channel) => channel.kind !== "self" && channel.kind !== "dm",
      ) ??
      null,
    [channels],
  );
  const visibleChannels = useMemo(
    () => channels.filter((channel) => channel.kind !== "self" && channel.kind !== "dm"),
    [channels],
  );
  const agentMembers = useMemo(
    () => members.filter((member) => member.kind === "agent"),
    [members],
  );

  return (
    <aside className="relative flex h-full w-full flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-[#09090b]">
      {/* Sidebar background gradient */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-zinc-50/50 to-transparent dark:from-white/[0.02]" />

      {/* Workspace Header */}
      <div className="relative z-10 flex h-14 items-center justify-between px-4">
        <button className="flex items-center gap-2 rounded-lg p-1.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-900 text-left">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-[0_0_15px_rgba(124,58,237,0.3)]">
            <Command className="h-5 w-5" />
          </div>
          <div className="flex flex-col items-start overflow-hidden">
            <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {bootstrap.organization?.name || "Ujima Agents"}
            </span>
          </div>
          <ChevronDown className="ml-auto h-4 w-4 text-zinc-400" />
        </button>
        <ThemeToggle compact />
      </div>

      {/* Search */}
      <div className="relative z-10 px-4 py-1.5">
        <div className="group relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 group-focus-within:text-violet-500" />
          <TextInput
            type="text"
            placeholder="Search"
            className="h-8 pl-9 pr-8 text-xs bg-zinc-50/50 focus:ring-1 focus:ring-violet-500 dark:bg-zinc-900/50"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Navigation Groups */}
      <div className="relative z-10 flex-1 overflow-y-auto px-2 py-3">


        {/* Channels */}
        <div className="mb-5">
          <SidebarSectionHeader
            title="Channels"
            onAdd={() => setIsChannelModalOpen(true)}
          />
          <div className="mt-1.5 space-y-0.5">
            {visibleChannels.map((channel) => (
              <SidebarItem
                key={channel.id}
                icon={<Hash className="h-4 w-4" />}
                label={channel.name}
                count={conversationUnreadCounts[channel.id]}
                active={
                  selected.type === "channel" && selected.id === channel.id
                }
                onClick={() =>
                  onSelect({
                    type: "channel",
                    id: channel.id,
                    name: channel.name,
                  })
                }
              />
            ))}
          </div>
        </div>

        {/* Agents */}
        <div className="mb-5">
          <SidebarSectionHeader
            title="Agents"
            onAdd={() => setIsAgentModalOpen(true)}
          />
          <div className="mt-1.5 space-y-0.5">
            {agentMembers.map((agent, idx) => (
              <SidebarItem
                key={agent.id}
                icon={<Avatar name={agent.name} colorIndex={idx} size="xs" />}
                label={agent.name}
                count={conversationUnreadCounts[agent.id]}
                active={selected.type === "agent" && selected.id === agent.id}
                status={resolveMemberActivity(agent, memberActivity)}
                goalMode={goalMode}
                onClick={() =>
                  onSelect({
                    type: "agent",
                    id: agent.id,
                    name: agent.name,
                  })
                }
              />
            ))}
          </div>
        </div>
      </div>



      {/* User Footer */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <Link
          href="/settings/organization"
          className="flex w-full items-center gap-3 rounded-xl p-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900 text-left"
        >
          <div className="relative shrink-0">
            <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-violet-500 to-indigo-500 shadow-[0_2px_10px_rgba(99,102,241,0.2)]" />
            <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-[#09090b]" />
          </div>
          <div className="flex flex-col items-start overflow-hidden">
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {bootstrap.auth.member?.name || "Admin"}
            </span>
          </div>
          <Settings className="ml-auto h-4 w-4 text-zinc-400" />
        </Link>
      </div>

      <CreateChannelModal
        isOpen={isChannelModalOpen}
        onClose={() => setIsChannelModalOpen(false)}
        onCreateChannel={onCreateChannel}
        onSelect={onSelect}
      />

      <CreateAgentModal
        isOpen={isAgentModalOpen}
        onClose={() => setIsAgentModalOpen(false)}
        rolePresets={rolePresets}
        initialProvider={initialProvider}
        primaryChannel={primaryChannel}
        onCreateAgent={onCreateAgent}
        onSelect={onSelect}
      />

      {agentEditorTargetId ? (
        <AgentEditorModal
          key={agentEditorTargetId}
          agent={agentMembers.find((item) => item.id === agentEditorTargetId) ?? null}
          teamSettings={teamSettings}
          rolePresets={rolePresets}
          visibleChannels={visibleChannels}
          onClose={() => onAgentEditorHandled?.()}
          onSelect={onSelect}
          onUpdateAgent={onUpdateAgent}
        />
      ) : null}
    </aside>
  );
}

export const SidebarItem = memo(function SidebarItem({
  icon,
  label,
  count,
  active,
  status,
  goalMode,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  status?: ActivityState;
  goalMode?: boolean;
  onClick?: () => void;
}) {
  const useRunner = active && goalMode && status === "working";
  return (
    <div
      className={`group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
        active
          ? "bg-violet-600/10 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <div
          className={`${active ? "text-violet-600 dark:text-violet-400" : "text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-zinc-100"}`}
        >
          {icon}
        </div>
        <span
          className={`flex-1 truncate ${active ? "font-semibold" : "font-medium"}`}
        >
          {label}
        </span>
        {count && count > 0 ? (
          <span className="ml-1 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            {count}
          </span>
        ) : null}
      </button>
      <div className="flex items-center gap-1.5">
        {useRunner ? (
          <RunningFigureIndicator />
        ) : status === "loading" ? (
          <div className="h-2 w-2 animate-spin rounded-full border border-violet-500 border-t-transparent" />
        ) : status === "working" ? (
          <div className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
        ) : status === "online" ? (
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
        ) : status === "idle" ? (
          <div className="h-2 w-2 rounded-full bg-amber-500" />
        ) : status === "offline" ? (
          <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        ) : status === "error" ? (
          <div className="h-2 w-2 rounded-full bg-red-500" />
        ) : null}
      </div>
    </div>
  );
});

function RunningFigureIndicator() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 origin-center text-violet-600 animate-running-figure motion-reduce:animate-none dark:text-violet-400"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        <circle cx="15.2" cy="4.2" r="1.35" fill="currentColor" stroke="none" />
        <path d="M12.7 7.2h-2.2l-1.7 3" />
        <path d="M10.9 12.2 8 16.8" />
        <path d="M12.5 9.1 16 10.2" />
        <path d="M11.2 13.2 7.5 15.1" />
        <path d="M12.7 10.9 15.6 15" />
        <path d="M16.2 10.2 19.2 9.1" />
        <path d="M9.4 7.8 6.6 9.1" opacity="0.45" />
        <path d="M17.6 16.8 20.2 18" opacity="0.45" />
      </g>
    </svg>
  );
}

export const SidebarSectionHeader = memo(function SidebarSectionHeader({
  title,
  onAdd,
}: {
  title: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
        {title}
      </h3>
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
