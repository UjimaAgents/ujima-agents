import type { BootstrapResponse } from "@ujima/api-schema";
import { parseDmThreadId } from "@ujima/shared/browser";
import type { SelectedConversation } from "./types";
import { isVisibleWorkspaceChannel } from "./workspace-channels";

type SearchParamsLike =
  | Record<string, string | string[] | undefined>
  | URLSearchParams
  | undefined;

function getParamValue(
  searchParams: SearchParamsLike,
  key: string,
): string | undefined {
  if (!searchParams) return undefined;
  if (typeof (searchParams as URLSearchParams).get === "function") {
    return (searchParams as URLSearchParams).get(key) ?? undefined;
  }
  const value = (searchParams as Record<string, string | string[] | undefined>)[key];
  return Array.isArray(value) ? value[0] : value;
}

function findAgent(
  bootstrap: BootstrapResponse,
  value: string,
): BootstrapResponse["members"][number] | undefined {
  return bootstrap.members.find(
    (member) => member.kind === "agent" && (member.id === value || member.name === value),
  );
}

function findChannel(
  bootstrap: BootstrapResponse,
  value: string,
): BootstrapResponse["channels"][number] | undefined {
  return bootstrap.channels.find(
    (channel) =>
      isVisibleWorkspaceChannel(channel) &&
      (channel.id === value || channel.name === value),
  );
}

function resolveAgentOnlyDm(
  bootstrap: BootstrapResponse,
  value: string,
): SelectedConversation | undefined {
  const dm = parseDmThreadId(value);
  if (!dm) return;
  const members = [dm.participantA, dm.participantB]
    .map((id) => bootstrap.members.find((member) => member.id === id))
    .filter((member): member is BootstrapResponse["members"][number] => member?.kind === "agent");
  if (members.length !== 2) return;
  return { type: "channel", id: value, name: members.map((member) => member.name).join(" & ") };
}

export function resolveSelectedConversationFromSearchParams(
  searchParams: SearchParamsLike,
  bootstrap?: BootstrapResponse,
): SelectedConversation | undefined {
  if (!bootstrap) return;

  const agentValue =
    getParamValue(searchParams, "agentId") ?? getParamValue(searchParams, "agent");
  if (agentValue) {
    const agent = findAgent(bootstrap, agentValue);
    if (agent) {
      return { type: "agent", id: agent.id, name: agent.name };
    }
  }

  const channelValue =
    getParamValue(searchParams, "channelId") ?? getParamValue(searchParams, "channel");
  if (channelValue) {
    const channel = findChannel(bootstrap, channelValue);
    if (channel) {
      return { type: "channel", id: channel.id, name: channel.name };
    }
    return resolveAgentOnlyDm(bootstrap, channelValue);
  }
}
