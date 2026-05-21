"use client";

import { FieldShell, TextArea, TextInput } from "@/components/ui/form-fields";
import { ProviderModelFields } from "@/components/ui/provider-model-fields";
import { Select } from "@/components/ui/select";
import { defaultModelForProvider } from "@/features/onboarding/types";
import type { RolePresetTemplate } from "@/features/onboarding/types";
import { AGENT_NAME_SUGGESTIONS } from "@/features/onboarding/agent-name-suggestions";
import { ChannelPicker, type ChannelPickerOption } from "./channel-picker";

export function RoleFormFields({
  templateName,
  templateOptions,
  onTemplateChange,
  agentName,
  onAgentNameChange,
  title,
  onTitleChange,
  instructions,
  onInstructionsChange,
  llm,
  model,
  onLlmChange,
  onModelChange,
  channelIds,
  onChannelIdsChange,
  channels,
}: {
  templateName: string;
  templateOptions: RolePresetTemplate[];
  onTemplateChange: (templateName: string) => void;
  agentName: string;
  onAgentNameChange: (value: string) => void;
  title: string;
  onTitleChange: (value: string) => void;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  llm: string;
  model: string;
  onLlmChange: (value: string) => void;
  onModelChange: (value: string) => void;
  channelIds: string[];
  onChannelIdsChange: (ids: string[]) => void;
  channels: ChannelPickerOption[];
}) {
  return (
    <div className="space-y-5">
      <FieldShell label="Role template" htmlFor="roleTemplate" hint="Pick the starter role shape first.">
        <Select
          id="roleTemplate"
          value={templateName}
          onChange={(e) => onTemplateChange(e.target.value)}
          className="w-full"
          options={templateOptions.map((template) => ({
            value: template.name,
            label: template.title,
          }))}
        />
      </FieldShell>

      <FieldShell label="Agent name" htmlFor="agentName">
        <TextInput
          id="agentName"
          list="agentNameSuggestions"
          value={agentName}
          onChange={(e) => onAgentNameChange(e.target.value)}
          placeholder="Frontend Engineer"
        />
        <datalist id="agentNameSuggestions">
          {AGENT_NAME_SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </FieldShell>

      <FieldShell label="Role title" htmlFor="roleTitle">
        <TextInput id="roleTitle" value={title} onChange={(e) => onTitleChange(e.target.value)} />
      </FieldShell>

      <FieldShell label="Role instructions" htmlFor="roleInstructions">
        <TextArea
          id="roleInstructions"
          className="min-h-28"
          value={instructions}
          onChange={(e) => onInstructionsChange(e.target.value)}
        />
      </FieldShell>

      <ProviderModelFields
        provider={llm}
        model={model}
        onProviderChange={(provider) => {
          onLlmChange(provider);
          onModelChange(defaultModelForProvider(provider));
        }}
        onModelChange={onModelChange}
        providerLabel="LLM provider"
        modelLabel="Model"
        providerId="roleLlm"
        modelId="roleModel"
      />

      <ChannelPicker
        channels={channels}
        selectedIds={channelIds}
        onChange={onChannelIdsChange}
      />
    </div>
  );
}
