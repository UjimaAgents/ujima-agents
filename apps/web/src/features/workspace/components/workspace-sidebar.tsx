"use client";

import {
  Hash,
  Search,
  Plus,
  Settings,
  Command,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { Avatar } from "./chat/primitives";
import { Modal } from "./modal";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation, WorkspaceRoleInput } from "../types";
import { useState, useMemo } from "react";
import {
  ChannelScopeRow,
  FieldShell,
  TextArea,
  TextInput,
} from "@/components/ui/form-fields";
import { ProviderModelFields } from "@/components/ui/provider-model-fields";
import { Select } from "@/components/ui/select";
import type { RolePresetTemplate } from "../../onboarding/types";
import { defaultModelForProvider } from "../../onboarding/types";
import { getSuggestedAgentName } from "../../onboarding/agent-name-suggestions";
import { Sparkles, Bot, ArrowRight, Search as SearchIcon } from "lucide-react";
import { resolveMemberActivity } from "../workspace-store";
import type { ActivityState } from "../activity-state";
import { ThemeToggle } from "@/components/theme-toggle";

interface WorkspaceSidebarProps {
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

function slugifyRoleName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function roleFromTemplate(template: RolePresetTemplate): WorkspaceRoleInput {
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

function customRole(title: string, instructions: string): WorkspaceRoleInput {
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

interface AgentEditorDraft {
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

function buildAgentEditorDraft({
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

const PERSONALITY_OPTIONS = [
  { value: "direct", label: "Direct" },
  { value: "thoughtful", label: "Thoughtful" },
  { value: "precise", label: "Precise" },
  { value: "warm", label: "Warm" },
  { value: "skeptical", label: "Skeptical" },
  { value: "pragmatic", label: "Pragmatic" },
] as const;

function listCsvValues(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsvValues(values: string[]) {
  return values.join(", ");
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function WorkspaceSidebar({
  bootstrap,
  rolePresets,
  teamSettings,
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
  const [newChannelName, setNewChannelName] = useState("");

  // Agent Modal State
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] =
    useState<RolePresetTemplate | null>(null);
  const [isCustomRole, setIsCustomRole] = useState(false);
  const [customRoleTitle, setCustomRoleTitle] = useState("");
  const [customRoleInstructions, setCustomRoleInstructions] = useState("");
  const [customAgentName, setCustomAgentName] = useState("");
  const initialProvider =
    bootstrap.providers.find((provider) => provider.hasKey)?.name ?? "openai";
  const [selectedLlm, setSelectedLlm] = useState(initialProvider);
  const [selectedModel, setSelectedModel] = useState(
    defaultModelForProvider(initialProvider),
  );
  const [isSavingChannel, setIsSavingChannel] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);

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
  const visibleChannels = channels.filter(
    (channel) => channel.kind !== "self" && channel.kind !== "dm",
  );
  const agentMembers = members.filter((member) => member.kind === "agent");

  const filteredRolePresets = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return rolePresets;
    return rolePresets.filter(
      (p) =>
        p.title.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.name.toLowerCase().includes(query),
    );
  }, [rolePresets, agentSearch]);

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

      <Modal
        isOpen={isChannelModalOpen}
        onClose={() => {
          setIsChannelModalOpen(false);
          setNewChannelName("");
          setChannelError(null);
        }}
        title="Create Channel"
      >
        <div className="space-y-4">
          <div>
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2 block">
              Channel Name
            </label>
            <div className="group relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                <Hash className="h-4 w-4" />
              </div>
              <TextInput
                autoFocus
                type="text"
                placeholder="e.g. marketing-plan"
                value={newChannelName}
                onChange={(e) =>
                  setNewChannelName(
                    e.target.value.toLowerCase().replace(/\s+/g, "-"),
                  )
                }
                className="px-10 py-3 bg-zinc-50 dark:bg-zinc-900/50 dark:focus:bg-black"
              />
            </div>
            <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
              Channels are where your team communicates. They’re best when
              organized around a topic — #leads, for example.
            </p>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            {channelError ? (
              <p className="mr-auto text-xs text-red-600 dark:text-red-400">
                {channelError}
              </p>
            ) : null}
            <button
              onClick={() => {
                setIsChannelModalOpen(false);
                setChannelError(null);
              }}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 transition-colors dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              disabled={!newChannelName || isSavingChannel}
              onClick={async () => {
                setChannelError(null);
                setIsSavingChannel(true);
                try {
                  const created = await onCreateChannel(newChannelName);
                  if (!created) throw new Error("Unable to create channel.");
                  setIsChannelModalOpen(false);
                  setNewChannelName("");
                  onSelect(created);
                } catch (err) {
                  setChannelError(
                    err instanceof Error
                      ? err.message
                      : "Unable to create channel.",
                  );
                } finally {
                  setIsSavingChannel(false);
                }
              }}
              className="rounded-xl bg-violet-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition-all disabled:opacity-50 disabled:shadow-none"
            >
              Create Channel
            </button>
          </div>
        </div>
      </Modal>

      {agentEditorTargetId ? (
        <AgentEditorModal
          key={agentEditorTargetId}
          agent={
            agentMembers.find((item) => item.id === agentEditorTargetId) ?? null
          }
          teamSettings={teamSettings}
          rolePresets={rolePresets}
          visibleChannels={visibleChannels}
          onClose={() => onAgentEditorHandled?.()}
          onSelect={onSelect}
          onUpdateAgent={onUpdateAgent}
        />
      ) : null}

      <Modal
        isOpen={isAgentModalOpen}
        onClose={() => {
          setIsAgentModalOpen(false);
          setAgentSearch("");
          setSelectedTemplate(null);
          setIsCustomRole(false);
          setCustomRoleTitle("");
          setCustomRoleInstructions("");
          setCustomAgentName("");
          setSelectedLlm(initialProvider);
          setSelectedModel(defaultModelForProvider(initialProvider));
          setAgentError(null);
        }}
        title={
          selectedTemplate || isCustomRole
            ? `Configure ${selectedTemplate?.title ?? "Custom Role"}`
            : "Add New Agent"
        }
      >
        {!selectedTemplate && !isCustomRole ? (
          <div className="space-y-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <TextInput
                type="text"
                placeholder="Search roles (e.g. Developer, QA...)"
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                className="pl-10 pr-4 py-2.5 bg-zinc-50 dark:bg-zinc-900/50"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                setIsCustomRole(true);
                setCustomAgentName(getSuggestedAgentName());
                setCustomRoleTitle("");
                setCustomRoleInstructions("");
              }}
              className="w-full flex items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:bg-violet-500/5"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900">
                <Plus className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-zinc-900 dark:text-white">
                  Custom role
                </p>
                <p className="text-xs text-zinc-500 line-clamp-1">
                  Create a role with its own instructions.
                </p>
              </div>
            </button>

            <div className="max-h-[350px] overflow-y-auto pr-1 space-y-2 custom-scrollbar">
              {filteredRolePresets.map((template) => (
                <button
                  key={template.key}
                  onClick={() => {
                    setSelectedTemplate(template);
                    setCustomAgentName(getSuggestedAgentName());
                  }}
                  className="w-full group flex items-start gap-3 rounded-xl border border-zinc-100 bg-white p-3 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-violet-500/5"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-lg shadow-violet-500/20">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-zinc-900 dark:text-white">
                      {template.title}
                    </p>
                    <p className="text-xs text-zinc-500 line-clamp-1">
                      {template.description}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-zinc-300 transition group-hover:text-violet-500 mt-1" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-4 p-4 rounded-2xl bg-violet-50 dark:bg-violet-500/5 border border-violet-100 dark:border-violet-500/10">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-xl shadow-violet-500/20">
                <Sparkles className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-violet-900 dark:text-violet-200">
                  {selectedTemplate?.title ?? "Custom role"}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {isCustomRole ? (
                <>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">
                      Role Title
                    </label>
                    <TextInput
                      type="text"
                      value={customRoleTitle}
                      onChange={(e) => setCustomRoleTitle(e.target.value)}
                      placeholder="e.g. Research Analyst"
                      className="bg-zinc-50 dark:bg-zinc-900/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">
                      Role Instructions
                    </label>
                    <TextArea
                      value={customRoleInstructions}
                      onChange={(e) =>
                        setCustomRoleInstructions(e.target.value)
                      }
                      placeholder="Describe what this agent should do."
                      className="min-h-28 bg-zinc-50 dark:bg-zinc-900/50"
                    />
                  </div>
                </>
              ) : null}
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">
                  Agent Name
                </label>
                <TextInput
                  type="text"
                  value={customAgentName}
                  onChange={(e) => setCustomAgentName(e.target.value)}
                  className="bg-zinc-50 dark:bg-zinc-900/50"
                />
              </div>

              <ProviderModelFields
                provider={selectedLlm}
                model={selectedModel}
                onProviderChange={setSelectedLlm}
                onModelChange={setSelectedModel}
                providerLabel="LLM provider"
                modelLabel="Model"
                providerId="agentProvider"
                modelId="agentModel"
              />

              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">
                  Channels
                </label>
                <div className="mt-3">
                  <ChannelScopeRow label={primaryChannel?.name ?? "general"} />
                </div>
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button
                onClick={() => {
                  setSelectedTemplate(null);
                  setIsCustomRole(false);
                  setCustomRoleTitle("");
                  setCustomRoleInstructions("");
                }}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 transition-colors dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Back
              </button>
              <button
                onClick={async () => {
                  const role = selectedTemplate
                    ? roleFromTemplate(selectedTemplate)
                    : customRole(customRoleTitle, customRoleInstructions);
                  setAgentError(null);
                  setIsSavingAgent(true);
                  try {
                    const created = await onCreateAgent({
                      name: customAgentName,
                      roleName: role.name,
                      channelIds: primaryChannel ? [primaryChannel.id] : [],
                      llm: selectedLlm,
                      model: selectedModel,
                      role: {
                        ...role,
                        channels: primaryChannel ? [primaryChannel.name] : [],
                      },
                    });
                    if (!created) throw new Error("Unable to create agent.");
                    setIsAgentModalOpen(false);
                    setAgentSearch("");
                    setSelectedTemplate(null);
                    setIsCustomRole(false);
                    setCustomRoleTitle("");
                    setCustomRoleInstructions("");
                    setCustomAgentName("");
                    setSelectedLlm(initialProvider);
                    setSelectedModel(defaultModelForProvider(initialProvider));
                    onSelect(created);
                  } catch (err) {
                    setAgentError(
                      err instanceof Error
                        ? err.message
                        : "Unable to create agent.",
                    );
                  } finally {
                    setIsSavingAgent(false);
                  }
                }}
                disabled={
                  isSavingAgent ||
                  !customAgentName.trim() ||
                  (isCustomRole &&
                    (!customRoleTitle.trim() || !customRoleInstructions.trim()))
                }
                className="flex-[2] rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition-all disabled:opacity-50 disabled:shadow-none"
              >
                Create Agent
              </button>
            </div>
            {agentError ? (
              <p className="text-xs text-red-600 dark:text-red-400">
                {agentError}
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </aside>
  );
}

function SidebarItem({
  icon,
  label,
  count,
  active,
  status,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  status?: ActivityState;
  onClick?: () => void;
}) {
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
        {status === "loading" && (
          <div className="h-2 w-2 animate-spin rounded-full border border-violet-500 border-t-transparent" />
        )}
        {status === "working" && (
          <div className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
        )}
        {status === "online" && (
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
        )}
        {status === "idle" && (
          <div className="h-2 w-2 rounded-full bg-amber-500" />
        )}
        {status === "offline" && (
          <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        )}
        {status === "error" && (
          <div className="h-2 w-2 rounded-full bg-red-500" />
        )}
      </div>
    </div>
    );
}

function SidebarSectionHeader({
  title,
  onAdd,
}: {
  title: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
      <span>{title}</span>
      {onAdd ? (
        <button type="button" onClick={onAdd} className="rounded p-0.5 opacity-40">
          <Plus className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function AgentEditorModal({
  agent,
  teamSettings,
  rolePresets,
  visibleChannels,
  onClose,
  onSelect,
  onUpdateAgent,
}: {
  agent: BootstrapResponse["members"][number] | null;
  teamSettings: WorkspaceSidebarProps["teamSettings"];
  rolePresets: RolePresetTemplate[];
  visibleChannels: BootstrapResponse["channels"];
  onClose: () => void;
  onSelect: (conv: SelectedConversation) => void;
  onUpdateAgent: WorkspaceSidebarProps["onUpdateAgent"];
}) {
  const [draft, setDraft] = useState<AgentEditorDraft | null>(() =>
    agent ? buildAgentEditorDraft({ agent, teamSettings, rolePresets, channels: visibleChannels }) : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTools = useMemo(() => {
    if (!draft) return [];
    return uniqueSorted([
      ...rolePresets.flatMap((preset) => preset.tools ?? []),
      ...(teamSettings?.roles.flatMap((role) => role.tools ?? []) ?? []),
      ...draft.tools,
    ]);
  }, [draft, rolePresets, teamSettings?.roles]);

  if (!agent || !draft) return null;

  const patchDraft = (patch: Partial<AgentEditorDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const toggleTool = (tool: string) => {
    setDraft((current) => {
      if (!current) return current;
      const exists = current.tools.includes(tool);
      return {
        ...current,
        tools: exists
          ? current.tools.filter((item) => item !== tool)
          : uniqueSorted([...current.tools, tool]),
      };
    });
  };

  const toggleChannel = (channelId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const channels = current.channels.includes(channelId)
        ? current.channels.filter((id) => id !== channelId)
        : [...current.channels, channelId];
      return { ...current, channels };
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Edit Agent">
      <div className="space-y-5">
        <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
          <Avatar name={draft.name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-zinc-900 dark:text-white">
              {draft.name}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
              {draft.roleName} · {draft.personalityName}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onSelect({
                type: "agent",
                id: draft.memberId,
                name: draft.name,
              })
            }
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            Open chat
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <FieldShell label="Agent name" htmlFor="agentName">
            <TextInput
              id="agentName"
              value={draft.name}
              onChange={(event) => patchDraft({ name: event.target.value })}
            />
          </FieldShell>

          <FieldShell label="Role name" htmlFor="agentRoleName">
            <TextInput
              id="agentRoleName"
              value={draft.roleName}
              onChange={(event) => patchDraft({ roleName: event.target.value })}
            />
          </FieldShell>
        </div>

        <FieldShell label="Personality" htmlFor="agentPersonality">
          <Select
            id="agentPersonality"
            value={draft.personalityName}
            onChange={(event) =>
              patchDraft({ personalityName: event.target.value })
            }
            options={[...PERSONALITY_OPTIONS]}
            placeholder="Select personality"
          />
        </FieldShell>

        <ProviderModelFields
          provider={draft.llm}
          model={draft.model}
          onProviderChange={(provider) =>
            patchDraft({
              llm: provider,
              model: defaultModelForProvider(provider),
            })
          }
          onModelChange={(model) => patchDraft({ model })}
          providerLabel="LLM provider"
          modelLabel="Model"
          providerId="agentEditProvider"
          modelId="agentEditModel"
        />

        <div className="grid gap-4 md:grid-cols-2">
          <FieldShell label="Role title" htmlFor="agentRoleTitle">
            <TextInput
              id="agentRoleTitle"
              value={draft.title}
              onChange={(event) => patchDraft({ title: event.target.value })}
            />
          </FieldShell>

          <FieldShell label="Role description" htmlFor="agentRoleDescription">
            <TextInput
              id="agentRoleDescription"
              value={draft.description}
              onChange={(event) => patchDraft({ description: event.target.value })}
            />
          </FieldShell>
        </div>

        <FieldShell label="Role instructions" htmlFor="agentInstructions">
          <TextArea
            id="agentInstructions"
            className="min-h-28"
            value={draft.instructions}
            onChange={(event) => patchDraft({ instructions: event.target.value })}
          />
        </FieldShell>

        <div className="grid gap-4">
          <FieldShell
            label="Workspace scopes"
            htmlFor="agentWorkspaceScopes"
            hint="Comma-separated paths"
          >
            <TextInput
              id="agentWorkspaceScopes"
              value={joinCsvValues(draft.workspaceScopes)}
              onChange={(event) =>
                patchDraft({ workspaceScopes: listCsvValues(event.target.value) })
              }
            />
          </FieldShell>

          <FieldShell label="Tools" htmlFor="agentTools" hint="Select available tools, or type custom values">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {availableTools.length > 0 ? (
                  availableTools.map((tool) => {
                    const selected = draft.tools.includes(tool);
                    return (
                      <button
                        key={tool}
                        type="button"
                        onClick={() => toggleTool(tool)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          selected
                            ? "border-violet-500 bg-violet-100 text-violet-700 dark:border-violet-400 dark:bg-violet-500/20 dark:text-violet-200"
                            : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        }`}
                        aria-pressed={selected}
                      >
                        {tool}
                      </button>
                    );
                  })
                ) : (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    No tools from presets or team settings.
                  </p>
                )}
              </div>
              <TextInput
                id="agentTools"
                value={joinCsvValues(draft.tools)}
                onChange={(event) =>
                  patchDraft({ tools: uniqueSorted(listCsvValues(event.target.value)) })
                }
              />
            </div>
          </FieldShell>

          <FieldShell label="Skills" htmlFor="agentSkills" hint="Comma-separated skill names">
            <TextInput
              id="agentSkills"
              value={joinCsvValues(draft.skills)}
              onChange={(event) => patchDraft({ skills: listCsvValues(event.target.value) })}
            />
          </FieldShell>
        </div>

        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Channels
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Select where this agent can participate.
          </p>
          <div className="mt-3 grid gap-2">
            {visibleChannels.map((channel) => (
              <label
                key={channel.id}
                className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800"
              >
                <input
                  type="checkbox"
                  checked={draft.channels.includes(channel.id)}
                  onChange={() => toggleChannel(channel.id)}
                  className="h-4 w-4 rounded border-zinc-300 text-violet-600 focus:ring-violet-500"
                />
                <span className="font-medium text-zinc-700 dark:text-zinc-200">
                  {channel.name}
                </span>
              </label>
            ))}
          </div>
        </div>

        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setError(null);
              setSaving(true);
              try {
                const updated = await onUpdateAgent({
                  previousAgentId: draft.memberId,
                  previousRoleName: draft.originalRoleName,
                  memberId: draft.memberId,
                  name: draft.name.trim(),
                  roleName: draft.roleName.trim(),
                  personalityName: draft.personalityName.trim() || "direct",
                  channelIds: draft.channels,
                  llm: draft.llm.trim(),
                  model: draft.model.trim(),
                  role: {
                    name: draft.roleName.trim(),
                    title: draft.title.trim() || draft.roleName.trim(),
                    description: draft.description.trim(),
                    instructions: draft.instructions.trim(),
                    kind: "agent",
                    provider: draft.llm.trim(),
                    model: draft.model.trim(),
                    workspaceScopes: draft.workspaceScopes,
                    tools: draft.tools,
                    channels: draft.channels
                      .map((channelId) => visibleChannels.find((channel) => channel.id === channelId)?.name)
                      .filter((channelName): channelName is string => Boolean(channelName)),
                    skills: draft.skills,
                  },
                });
                if (!updated) throw new Error("Unable to update agent.");
                onClose();
                onSelect({
                  type: "agent",
                  id: updated.id,
                  name: updated.name,
                });
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Unable to update agent.",
                );
              } finally {
                setSaving(false);
              }
            }}
            className="rounded-xl bg-violet-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50 disabled:shadow-none"
          >
            Save changes
          </button>
        </div>
      </div>
    </Modal>
  );
}
