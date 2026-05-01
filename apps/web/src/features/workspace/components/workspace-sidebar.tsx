"use client";

import {
  Hash,
  Search,
  Plus,
  Settings,
  ChevronDown,
  Command,
} from "lucide-react";
import { Avatar } from "./chat/primitives";
import { Modal } from "./modal";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation } from "../types";
import { useState, useMemo } from "react";
import type { RolePresetTemplate } from "../../onboarding/types";
import { getSuggestedAgentName } from "../../onboarding/agent-name-suggestions";
import { Sparkles, Bot, ArrowRight, Search as SearchIcon } from "lucide-react";

interface WorkspaceSidebarProps {
  bootstrap: BootstrapResponse;
  rolePresets: RolePresetTemplate[];
  selected: SelectedConversation;
  onSelect: (conv: SelectedConversation) => void;
}

export function WorkspaceSidebar({
  bootstrap,
  rolePresets,
  selected,
  onSelect,
}: WorkspaceSidebarProps) {
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  
  // Agent Modal State
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<RolePresetTemplate | null>(null);
  const [customAgentName, setCustomAgentName] = useState("");
  const [selectedLlm, setSelectedLlm] = useState(bootstrap.providers.find(p => p.hasKey)?.name || "");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  
  // New Provider State
  const [isAddingNewProvider, setIsAddingNewProvider] = useState(false);
  const [newProviderName, setNewProviderName] = useState("OpenAI");
  const [newProviderKey, setNewProviderKey] = useState("");

  const LLM_OPTIONS = ["Anthropic", "OpenAI", "Google", "Mistral", "DeepSeek", "xAI", "Kimi", "Zhipu AI", "OpenAI Codex"] as const;
  
  const visibleChannels = bootstrap.channels.filter(
    (channel) => channel.kind !== "self" && channel.kind !== "dm",
  );
  const agentMembers = bootstrap.members.filter(
    (member) => member.kind === "agent",
  );

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
      </div>

      {/* Search */}
      <div className="relative z-10 px-4 py-1.5">
        <div className="group relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 group-focus-within:text-violet-500" />
          <input
            type="text"
            placeholder="Search"
            className="h-8 w-full rounded-lg border border-zinc-200 bg-zinc-50/50 pl-9 pr-8 text-xs transition focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:focus:border-violet-500"
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
          <div className="flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
            <span>Channels</span>
            <button 
              onClick={() => setIsChannelModalOpen(true)}
              className="rounded p-0.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-1.5 space-y-0.5">
            {visibleChannels.map((channel) => (
              <SidebarItem
                key={channel.id}
                icon={<Hash className="h-4 w-4" />}
                label={channel.name}
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
          <div className="flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
            <span>Agents</span>
            <button 
              onClick={() => setIsAgentModalOpen(true)}
              className="rounded p-0.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-1.5 space-y-0.5">
            {agentMembers.map((agent, idx) => (
              <SidebarItem
                key={agent.id}
                icon={<Avatar name={agent.name} colorIndex={idx} size="xs" />}
                label={agent.name}
                active={
                  selected.type === "agent" && selected.id === agent.id
                }
                status={
                  agent.presence === "online" ? "online" : "offline"
                }
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
        <button className="flex w-full items-center gap-3 rounded-xl p-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900 text-left">
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
        </button>
      </div>

      <Modal 
        isOpen={isChannelModalOpen} 
        onClose={() => {
          setIsChannelModalOpen(false);
          setNewChannelName("");
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
              <input 
                autoFocus
                type="text" 
                placeholder="e.g. marketing-plan"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-10 py-3 text-sm focus:border-violet-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all dark:border-zinc-800 dark:bg-zinc-900/50 dark:focus:border-violet-500 dark:focus:bg-black"
              />
            </div>
            <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
              Channels are where your team communicates. They’re best when organized around a topic — #leads, for example.
            </p>
          </div>
          
          <div className="pt-4 flex justify-end gap-3">
            <button 
              onClick={() => setIsChannelModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 transition-colors dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button 
              disabled={!newChannelName}
              onClick={() => {
                // Here we would call the API
                console.log("Creating channel:", newChannelName);
                setIsChannelModalOpen(false);
                setNewChannelName("");
              }}
              className="rounded-xl bg-violet-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition-all disabled:opacity-50 disabled:shadow-none"
            >
              Create Channel
            </button>
          </div>
        </div>
      </Modal>

      <Modal 
        isOpen={isAgentModalOpen} 
        onClose={() => {
          setIsAgentModalOpen(false);
          setAgentSearch("");
          setSelectedTemplate(null);
          setCustomAgentName("");
        }} 
        title={selectedTemplate ? `Configure ${selectedTemplate.title}` : "Add New Agent"}
      >
        {!selectedTemplate ? (
          <div className="space-y-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <input 
                type="text"
                placeholder="Search roles (e.g. Developer, QA...)"
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-10 pr-4 py-2.5 text-sm focus:border-violet-500 focus:outline-none transition-all dark:border-zinc-800 dark:bg-zinc-900/50"
              />
            </div>
            
            <div className="max-h-[350px] overflow-y-auto pr-1 space-y-2 custom-scrollbar">
              <button
                onClick={() => {
                  setSelectedTemplate({
                    name: "custom",
                    title: "Custom Agent",
                    description: "Define a unique role and instructions from scratch.",
                    instructions: "",
                    channels: [],
                    industry: "custom",
                    key: "custom",
                  });
                  setCustomAgentName(getSuggestedAgentName());
                }}
                className="w-full group flex items-start gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-3 text-left transition hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-700 dark:bg-zinc-900/30 dark:hover:bg-violet-500/5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  <Plus className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-zinc-900 dark:text-white">Custom Agent</p>
                  <p className="text-xs text-zinc-500 line-clamp-1">Define unique instructions and roles.</p>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-300 transition group-hover:text-violet-500 mt-1" />
              </button>

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
                    <p className="text-sm font-bold text-zinc-900 dark:text-white">{template.title}</p>
                    <p className="text-xs text-zinc-500 line-clamp-1">{template.description}</p>
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
                <p className="text-sm font-bold text-violet-900 dark:text-violet-200">{selectedTemplate.title}</p>
                <p className="text-xs text-violet-600 dark:text-violet-400">Assign a name and provider to your new agent.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">Agent Name</label>
                <input 
                  type="text"
                  value={customAgentName}
                  onChange={(e) => setCustomAgentName(e.target.value)}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm focus:border-violet-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900/50"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">LLM Provider</label>
                <select 
                  value={isAddingNewProvider ? "new" : selectedLlm}
                  onChange={(e) => {
                    if (e.target.value === "new") {
                      setIsAddingNewProvider(true);
                      setSelectedLlm("");
                    } else {
                      setIsAddingNewProvider(false);
                      setSelectedLlm(e.target.value);
                    }
                  }}
                  className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm focus:border-violet-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900/50"
                >
                  {bootstrap.providers.filter(p => p.hasKey).length > 0 ? (
                    <optgroup label="Configured Providers">
                      {bootstrap.providers.filter(p => p.hasKey).map(p => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </optgroup>
                  ) : (
                    <option value="" disabled>No providers configured</option>
                  )}
                  <optgroup label="Other">
                    <option value="new">+ Add new provider...</option>
                  </optgroup>
                </select>
              </div>

              {isAddingNewProvider && (
                <div className="space-y-4 p-4 rounded-xl border border-violet-100 bg-violet-50/50 dark:border-violet-500/10 dark:bg-violet-500/5 animate-in slide-in-from-top-2 duration-200">
                  <div>
                    <label className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-widest mb-1.5 block">Provider Type</label>
                    <select
                      value={newProviderName}
                      onChange={(e) => setNewProviderName(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm focus:border-violet-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      {LLM_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-widest mb-1.5 block">API Key</label>
                    <input
                      type="password"
                      placeholder={`Enter ${newProviderName} API Key`}
                      value={newProviderKey}
                      onChange={(e) => setNewProviderKey(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm focus:border-violet-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1.5 block">Channels</label>
                <div className="flex flex-wrap gap-2 max-h-[100px] overflow-y-auto p-1">
                  {visibleChannels.map((channel) => {
                    const isSelected = selectedChannels.includes(channel.id);
                    return (
                      <button
                        key={channel.id}
                        onClick={() => {
                          setSelectedChannels(prev => 
                            isSelected ? prev.filter(id => id !== channel.id) : [...prev, channel.id]
                          );
                        }}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                          isSelected
                            ? "border-violet-500 bg-violet-600 text-white shadow-md shadow-violet-500/20"
                            : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
                        }`}
                      >
                        <Hash className="h-3 w-3" />
                        {channel.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-2 flex gap-3">
              <button 
                onClick={() => setSelectedTemplate(null)}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 transition-colors dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Back
              </button>
              <button 
                onClick={() => {
                  console.log("Creating Agent:", { 
                    template: selectedTemplate, 
                    name: customAgentName, 
                    llm: isAddingNewProvider ? newProviderName : selectedLlm,
                    newApiKey: isAddingNewProvider ? newProviderKey : undefined,
                    channels: selectedChannels 
                  });
                  setIsAgentModalOpen(false);
                  setSelectedTemplate(null);
                  setSelectedChannels([]);
                  setIsAddingNewProvider(false);
                  setNewProviderKey("");
                }}
                disabled={isAddingNewProvider && !newProviderKey.trim()}
                className="flex-[2] rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition-all disabled:opacity-50 disabled:shadow-none"
              >
                Create Agent
              </button>
            </div>
          </div>
        )}
      </Modal>
    </aside>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  status,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  status?: "online" | "offline" | "active";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition text-left ${
        active
          ? "bg-violet-600/10 text-violet-700 dark:bg-violet-500/10 dark:text-violet-400"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
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
      {status === "online" && (
        <div className="h-2 w-2 rounded-full bg-emerald-500" />
      )}
      {status === "offline" && (
        <div className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
      )}
    </button>
  );
}
