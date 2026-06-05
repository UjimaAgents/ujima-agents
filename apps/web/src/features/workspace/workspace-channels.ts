import type { BootstrapResponse } from "@ujima/api-schema";
import type { SelectedConversation } from "./types";

export type WorkspaceChannel = BootstrapResponse["channels"][number];

export function isVisibleWorkspaceChannel(channel: Pick<WorkspaceChannel, "kind" | "archivedAt">): boolean {
  return channel.kind !== "self" && channel.kind !== "dm" && !channel.archivedAt;
}

export function visibleWorkspaceChannels(channels: WorkspaceChannel[]): WorkspaceChannel[] {
  return channels.filter(isVisibleWorkspaceChannel);
}

export function resolveDefaultConversation(
  channels: WorkspaceChannel[],
): SelectedConversation | undefined {
  const visible = visibleWorkspaceChannels(channels);
  const channel = visible.find((entry) => entry.name === "general") ?? visible[0];
  if (!channel) return undefined;
  return { type: "channel", id: channel.id, name: channel.name };
}
