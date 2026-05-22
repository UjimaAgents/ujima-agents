"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { TextInput, TextArea } from "@/components/ui/form-fields";
import { ProviderModelFields } from "@/components/ui/provider-model-fields";
import { Search as SearchIcon, Bot, ArrowRight, Sparkles, Plus } from "lucide-react";
import { getSuggestedAgentName } from "../../../onboarding/agent-name-suggestions";
import { defaultModelForProvider, RolePresetTemplate } from "../../../onboarding/types";
import { ChannelPicker, type ChannelPickerOption } from "@/features/team/channel-picker";
import {
  roleFromTemplate,
  customRole,
} from "../workspace-sidebar";
import type { SelectedConversation } from "../../types";
import type { CreateAgentHandler } from "@/features/team/agent-mutations";

function defaultChannelIds(channels: ChannelPickerOption[], preferredId?: string) {
  if (preferredId && channels.some((c) => c.id === preferredId)) return [preferredId];
  const general = channels.find((c) => c.name === "general");
  if (general) return [general.id];
  return channels[0] ? [channels[0].id] : [];
}

interface CreateAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  rolePresets: RolePresetTemplate[];
  initialProvider: string;
  channels: ChannelPickerOption[];
  primaryChannelId?: string;
  onCreateAgent: CreateAgentHandler;
  onSelect: (created: SelectedConversation) => void;
}

export function CreateAgentModal(props: CreateAgentModalProps) {
  if (!props.isOpen) return null;
  return <CreateAgentModalActive {...props} />;
}

function CreateAgentModalActive({
  onClose,
  rolePresets,
  initialProvider,
  channels,
  primaryChannelId,
  onCreateAgent,
  onSelect,
}: CreateAgentModalProps) {
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<RolePresetTemplate | null>(null);
  const [isCustomRole, setIsCustomRole] = useState(false);
  const [customRoleTitle, setCustomRoleTitle] = useState("");
  const [customRoleInstructions, setCustomRoleInstructions] = useState("");
  const [customAgentName, setCustomAgentName] = useState("");
  const [selectedLlm, setSelectedLlm] = useState(initialProvider);
  const [selectedModel, setSelectedModel] = useState(defaultModelForProvider(initialProvider));
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>(() =>
    defaultChannelIds(channels, primaryChannelId),
  );
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const filteredRolePresets = rolePresets.filter((p) => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      p.title.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      p.name.toLowerCase().includes(query)
    );
  });

  const reset = () => {
    setAgentSearch("");
    setSelectedTemplate(null);
    setIsCustomRole(false);
    setCustomRoleTitle("");
    setCustomRoleInstructions("");
    setCustomAgentName("");
    setSelectedLlm(initialProvider);
    setSelectedModel(defaultModelForProvider(initialProvider));
    setSelectedChannelIds(defaultChannelIds(channels, primaryChannelId));
    setAgentError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const channelNames = selectedChannelIds
    .map((id) => channels.find((c) => c.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <Modal
      isOpen
      onClose={handleClose}
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
              <p className="text-sm font-bold text-zinc-900 dark:text-white">Custom role</p>
              <p className="text-xs text-zinc-500 line-clamp-1">Create a role with its own instructions.</p>
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
                    onChange={(e) => setCustomRoleInstructions(e.target.value)}
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
              onProviderChange={(provider) => {
                setSelectedLlm(provider);
                setSelectedModel(defaultModelForProvider(provider));
              }}
              onModelChange={setSelectedModel}
              providerLabel="LLM provider"
              modelLabel="Model"
              providerId="agentProvider"
              modelId="agentModel"
            />

            <ChannelPicker
              channels={channels}
              selectedIds={selectedChannelIds}
              onChange={setSelectedChannelIds}
            />
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
                    channelIds: selectedChannelIds,
                    llm: selectedLlm,
                    model: selectedModel,
                    role: {
                      ...role,
                      channels: channelNames.length > 0 ? channelNames : ["general"],
                    },
                  });
                  if (!created) throw new Error("Unable to create agent.");
                  handleClose();
                  onSelect(created);
                } catch (err) {
                  setAgentError(err instanceof Error ? err.message : "Unable to create agent.");
                } finally {
                  setIsSavingAgent(false);
                }
              }}
              disabled={
                isSavingAgent ||
                !customAgentName.trim() ||
                selectedChannelIds.length === 0 ||
                (isCustomRole && (!customRoleTitle.trim() || !customRoleInstructions.trim()))
              }
              className="flex-[2] rounded-xl bg-violet-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-violet-500/20 hover:bg-violet-700 transition-all disabled:opacity-50 disabled:shadow-none"
            >
              Create Agent
            </button>
          </div>
          {agentError ? <p className="text-xs text-red-600 dark:text-red-400">{agentError}</p> : null}
        </div>
      )}
    </Modal>
  );
}
