"use client";

import { Hash } from "lucide-react";
import { FieldShell, TextArea, TextInput } from "@/components/ui/form-fields";

export function normalizeChannelName(value: string, mode: "create" | "edit") {
  const trimmed = value.trim();
  if (mode === "edit") return trimmed;
  return trimmed.toLowerCase().replace(/\s+/g, "-");
}

export function ChannelFormFields({
  mode,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  nameId = "channel-name",
  descriptionId = "channel-description",
}: {
  mode: "create" | "edit";
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  nameId?: string;
  descriptionId?: string;
}) {
  return (
    <>
      <FieldShell label="Channel name" htmlFor={nameId}>
        <div className="relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
            <Hash className="h-4 w-4" />
          </div>
          <TextInput
            id={nameId}
            value={name}
            onChange={(e) => onNameChange(normalizeChannelName(e.target.value, mode))}
            className="pl-10"
            placeholder="marketing-plan"
          />
        </div>
      </FieldShell>
      <FieldShell label="Description" htmlFor={descriptionId} hint="What is this channel for?">
        <TextArea
          id={descriptionId}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="What is this channel for?"
        />
      </FieldShell>
    </>
  );
}
