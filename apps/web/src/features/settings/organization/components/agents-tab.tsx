"use client";

import { Bot, PencilLine, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type {
  BootstrapResponse,
  OrganizationSettingsResponse,
  ProviderStatus,
  TeamSettingsResponse,
} from "@ujima/api-schema";
import type { RolePresetTemplate } from "@/features/onboarding/types";
import type {
  CreateAgentHandler,
  UpdateAgentHandler,
} from "@/features/team/agent-mutations";
import { settingsFetch } from "@/features/settings/shared/settings-api";
import { AgentEditorModal } from "@/features/workspace/components/sidebar/agent-editor-modal";
import { CreateAgentModal } from "@/features/workspace/components/sidebar/create-agent-modal";
import { Avatar } from "@/features/workspace/components/chat/primitives";
import {
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsList, SettingsListRow } from "@/features/settings/shared/settings-list-row";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";
import { normalizeProviderKey } from "@/features/providers/catalog";

type Member = NonNullable<OrganizationSettingsResponse["members"]>[number];

export function AgentsTab({
  orgId,
  members,
  teamSettings,
  channels,
  providers,
  rolePresets,
  onMemberUpdated,
  onMemberCreated,
}: {
  orgId: string;
  members: Member[];
  teamSettings: TeamSettingsResponse | null;
  channels: BootstrapResponse["channels"];
  providers: ProviderStatus[];
  rolePresets: RolePresetTemplate[];
  onMemberUpdated: (member: Member) => void;
  onMemberCreated: (member: Member) => void;
}) {
  const agentMembers = members.filter((m) => m.kind === "agent");
  const [editingAgent, setEditingAgent] = useState<Member | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const initialProvider = useMemo(() => {
    const configured = providers.find((p) => p.hasKey);
    return configured ? normalizeProviderKey(configured.name) : "openai";
  }, [providers]);

  const onUpdateAgent: UpdateAgentHandler = useCallback(
    async (input) => {
      if (!orgId) throw new Error("Missing organization context.");
      const member = await settingsFetch<Member>(
        `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(input.memberId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: input.name,
            roleName: input.roleName,
            personalityName: input.personalityName,
            channelIds: input.channelIds,
            llm: input.llm,
            model: input.model,
            role: input.role,
          }),
        },
        "Failed to update agent.",
      );
      onMemberUpdated(member);
      return member;
    },
    [orgId, onMemberUpdated],
  );

  const onCreateAgent: CreateAgentHandler = useCallback(
    async (input) => {
      if (!orgId) throw new Error("Missing organization context.");
      const member = await settingsFetch<Member>(
        `/api/orgs/${encodeURIComponent(orgId)}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            kind: "agent",
          }),
        },
        "Failed to create agent.",
      );
      onMemberCreated(member);
      return { type: "agent" as const, id: member.id, name: member.name };
    },
    [orgId, onMemberCreated],
  );

  return (
    <>
      <SettingsTabActions>
        <SettingsPrimaryButton onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4" />
          Add agent
        </SettingsPrimaryButton>
      </SettingsTabActions>

      {agentMembers.length === 0 ? (
        <SettingsEmptyState
          icon={Bot}
          title="No agents"
          description="Add agents to run tasks and respond in your channels."
          action={
            <SettingsPrimaryButton onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />
              Add agent
            </SettingsPrimaryButton>
          }
        />
      ) : (
        <SettingsList>
          {agentMembers.map((member, idx) => {
            const role = teamSettings?.roles.find((r) => r.name === member.roleName);
            return (
              <SettingsListRow
                key={member.id}
                leading={<Avatar name={member.name} colorIndex={idx} size="sm" />}
                primary={
                  <span className="flex flex-wrap items-center gap-2">
                    {member.name}
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {member.roleName}
                    </span>
                  </span>
                }
                secondary={
                  <>
                    {member.llm ?? role?.provider ?? "—"}
                    {member.model ? ` / ${member.model}` : ""}
                  </>
                }
                actions={
                  <SettingsSecondaryButton onClick={() => setEditingAgent(member)}>
                    <PencilLine className="h-3.5 w-3.5" />
                    Edit
                  </SettingsSecondaryButton>
                }
              />
            );
          })}
        </SettingsList>
      )}

      <CreateAgentModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        rolePresets={rolePresets}
        initialProvider={initialProvider}
        channels={channels.map((c) => ({ id: c.id, name: c.name }))}
        onCreateAgent={onCreateAgent}
        onSelect={() => setShowCreate(false)}
      />

      {editingAgent ? (
        <AgentEditorModal
          agent={editingAgent}
          teamSettings={teamSettings}
          rolePresets={rolePresets}
          visibleChannels={channels}
          onClose={() => setEditingAgent(null)}
          onSelect={() => setEditingAgent(null)}
          onUpdateAgent={onUpdateAgent}
        />
      ) : null}
    </>
  );
}
