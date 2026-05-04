"use client";

import { Plus, PencilLine, Trash2, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { TextInput, FieldShell, TextArea } from "@/components/ui/form-fields";
import { ProviderModelFields } from "@/components/ui/provider-model-fields";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/features/workspace/components/chat/primitives";
import { defaultModelForProvider } from "@/features/onboarding/types";
import type { BootstrapResponse, OrganizationSettingsResponse } from "@ujima/api-schema";

type Member = NonNullable<OrganizationSettingsResponse["members"]>[number];

interface TeamSettingsData {
  agents: Array<{ name: string; roleName: string; personalityName: string; kind: string }>;
  roles: Array<{
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
  }>;
}

const PERSONALITY_OPTIONS = [
  { value: "direct", label: "Direct" },
  { value: "thoughtful", label: "Thoughtful" },
  { value: "precise", label: "Precise" },
  { value: "warm", label: "Warm" },
  { value: "skeptical", label: "Skeptical" },
  { value: "pragmatic", label: "Pragmatic" },
] as const;

export function AgentsTab({
  orgId,
  members,
  teamSettings,
  bootstrap,
}: {
  orgId: string;
  members: Member[];
  teamSettings: TeamSettingsData | null;
  bootstrap: BootstrapResponse;
}) {
  const agentMembers = members.filter((m) => m.kind === "agent");
  const [menuId, setMenuId] = useState<string | null>(null);
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startEdit = (member: Member) => {
    const role = teamSettings?.roles.find((r) => r.name === member.roleName);
    const memberChannelIds = bootstrap.channels
      .filter((channel) => channel.memberIds?.includes(member.id))
      .map((channel) => channel.id);
    setAgentDrafts((prev) => ({
      ...prev,
      [member.id]: {
        name: member.name,
        roleName: member.roleName,
        personalityName: teamSettings?.agents.find((a) => a.name === member.id)?.personalityName ?? "direct",
        llm: member.llm ?? role?.provider ?? "openai",
        model: member.model ?? role?.model ?? defaultModelForProvider(member.llm ?? "openai"),
        title: role?.title ?? member.roleName,
        description: role?.description ?? "",
        instructions: role?.instructions ?? "",
        channelIds: memberChannelIds,
        workspaceScopes: role?.workspaceScopes ?? [],
        tools: role?.tools ?? [],
        skills: role?.skills ?? [],
      },
    }));
    setMenuId(null);
  };

  const saveAgent = async (memberId: string) => {
    const draft = agentDrafts[memberId];
    if (!draft || !orgId) return;
    setError(null);
    setSavingId(memberId);
    try {
      const response = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name.trim(),
          roleName: draft.roleName.trim(),
          personalityName: draft.personalityName.trim() || "direct",
          llm: draft.llm.trim(),
          model: draft.model.trim(),
          channelIds: draft.channelIds,
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
            channels: draft.channelIds
              .map((channelId) => bootstrap.channels.find((channel) => channel.id === channelId)?.name)
              .filter((name): name is string => Boolean(name)),
            skills: draft.skills,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to update agent.");
      }
      setAgentDrafts((prev) => {
        const next = { ...prev };
        delete next[memberId];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {agentMembers.length} agent{agentMembers.length !== 1 ? "s" : ""} configured.
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {agentMembers.map((member, idx) => {
          const editing = agentDrafts[member.id];
          return (
            <div
              key={member.id}
              className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 dark:border-zinc-800 dark:bg-zinc-950"
            >
              {editing ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                    <Avatar name={editing.name} size="lg" />
                    <div className="min-w-0 flex-1">
                      <input
                        type="text"
                        value={editing.name}
                        onChange={(e) =>
                          setAgentDrafts((prev) => ({
                            ...prev,
                            [member.id]: { ...editing!, name: e.target.value },
                          }))
                        }
                        className="w-full bg-transparent text-base font-semibold text-zinc-900 outline-none dark:text-zinc-100"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FieldShell label="Role name" htmlFor={`role-${member.id}`}>
                      <TextInput
                        id={`role-${member.id}`}
                        value={editing.roleName}
                        onChange={(e) =>
                          setAgentDrafts((prev) => ({
                            ...prev,
                            [member.id]: { ...editing!, roleName: e.target.value },
                          }))
                        }
                      />
                    </FieldShell>
                    <FieldShell label="Personality" htmlFor={`personality-${member.id}`}>
                      <Select
                        id={`personality-${member.id}`}
                        value={editing.personalityName}
                        onChange={(e) =>
                          setAgentDrafts((prev) => ({
                            ...prev,
                            [member.id]: { ...editing!, personalityName: e.target.value },
                          }))
                        }
                        options={[...PERSONALITY_OPTIONS]}
                      />
                    </FieldShell>
                  </div>

                  <ProviderModelFields
                    provider={editing.llm}
                    model={editing.model}
                    onProviderChange={(llm) =>
                      setAgentDrafts((prev) => ({
                        ...prev,
                        [member.id]: { ...editing!, llm, model: defaultModelForProvider(llm) },
                      }))
                    }
                    onModelChange={(model) =>
                      setAgentDrafts((prev) => ({
                        ...prev,
                        [member.id]: { ...editing!, model },
                      }))
                    }
                    providerLabel="LLM provider"
                    modelLabel="Model"
                    providerId={`provider-${member.id}`}
                    modelId={`model-${member.id}`}
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <FieldShell label="Role title" htmlFor={`title-${member.id}`}>
                      <TextInput
                        id={`title-${member.id}`}
                        value={editing.title}
                        onChange={(e) =>
                          setAgentDrafts((prev) => ({
                            ...prev,
                            [member.id]: { ...editing!, title: e.target.value },
                          }))
                        }
                      />
                    </FieldShell>
                    <FieldShell label="Role description" htmlFor={`desc-${member.id}`}>
                      <TextInput
                        id={`desc-${member.id}`}
                        value={editing.description}
                        onChange={(e) =>
                          setAgentDrafts((prev) => ({
                            ...prev,
                            [member.id]: { ...editing!, description: e.target.value },
                          }))
                        }
                      />
                    </FieldShell>
                  </div>

                  <FieldShell label="Role instructions" htmlFor={`instr-${member.id}`}>
                    <TextArea
                      id={`instr-${member.id}`}
                      className="min-h-24"
                      value={editing.instructions}
                      onChange={(e) =>
                        setAgentDrafts((prev) => ({
                          ...prev,
                          [member.id]: { ...editing!, instructions: e.target.value },
                        }))
                      }
                    />
                  </FieldShell>

                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setAgentDrafts((prev) => {
                          const next = { ...prev };
                          delete next[member.id];
                          return next;
                        })
                      }
                      className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={savingId === member.id}
                      onClick={() => saveAgent(member.id)}
                      className="rounded-xl bg-violet-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-violet-500/20 transition hover:bg-violet-700 disabled:opacity-50 disabled:shadow-none"
                    >
                      {savingId === member.id ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-4">
                    <Avatar name={member.name} colorIndex={idx} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{member.name}</p>
                        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                          {member.roleName}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {member.llm ?? teamSettings?.roles.find((r) => r.name === member.roleName)?.provider ?? "—"}
                        {member.model ? ` / ${member.model}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setMenuId((current) => (current === member.id ? null : member.id))}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {menuId === member.id ? (
                      <div className="absolute right-0 top-11 z-20 w-40 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
                        <button
                          type="button"
                          onClick={() => startEdit(member)}
                          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                        >
                          <PencilLine className="h-4 w-4" />
                          Edit
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}

interface AgentDraft {
  name: string;
  roleName: string;
  personalityName: string;
  llm: string;
  model: string;
  title: string;
  description: string;
  instructions: string;
  channelIds: string[];
  workspaceScopes: string[];
  tools: string[];
  skills: string[];
}
