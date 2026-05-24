"use client";

import { useState, useMemo } from "react";
import { Modal } from "@/components/ui/modal";
import { Avatar } from "../chat/primitives";
import { FieldShell, TextArea, TextInput } from "@/components/ui/form-fields";
import { ProviderModelFields } from "@/components/ui/provider-model-fields";
import { ChannelPicker } from "@/features/team/channel-picker";
import { Select } from "@/components/ui/select";
import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation } from "../../types";
import type { RolePresetTemplate } from "../../../onboarding/types";
import { defaultModelForProvider } from "../../../onboarding/types";
import {
  AgentEditorDraft,
  buildAgentEditorDraft,
  joinCsvValues,
  listCsvValues,
  PERSONALITY_OPTIONS,
  uniqueSorted,
} from "../workspace-sidebar";
import type { UpdateAgentHandler } from "@/features/team/agent-mutations";
import type { WorkspaceSidebarProps } from "../workspace-sidebar";

type TeamRole = NonNullable<WorkspaceSidebarProps["teamSettings"]>["roles"][number];

export function AgentEditorModal({
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
  onUpdateAgent: UpdateAgentHandler;
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
      ...(teamSettings?.roles.flatMap((role: TeamRole) => role.tools ?? []) ?? []),
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
                            ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400 dark:bg-violet-500/20 dark:text-violet-200"
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

        <ChannelPicker
          channels={visibleChannels.map((channel) => ({ id: channel.id, name: channel.name }))}
          selectedIds={draft.channels}
          onChange={(channelIds) => patchDraft({ channels: channelIds })}
        />

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
