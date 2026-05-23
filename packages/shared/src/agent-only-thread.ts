import { parseDmThreadId } from './conversations.js';

export type AgentOnlyMemberKind = 'human' | 'agent';

export interface AgentOnlyMember {
  id: string;
  kind: AgentOnlyMemberKind;
}

export interface AgentOnlyChannel {
  id: string;
  memberIds: string[];
}

export function isAgentOnlyThread(
  threadId: string,
  members: readonly AgentOnlyMember[],
  channels?: readonly AgentOnlyChannel[],
): boolean {
  const dm = parseDmThreadId(threadId);
  if (dm) {
    const participants = [dm.participantA, dm.participantB]
      .map((id) => members.find((member) => member.id === id))
      .filter((member): member is AgentOnlyMember => member?.kind === 'agent');
    return participants.length === 2;
  }

  const channel = channels?.find((entry) => entry.id === threadId);
  if (!channel?.memberIds.length) return false;
  const roster = channel.memberIds
    .map((memberId) => members.find((member) => member.id === memberId))
    .filter((member): member is AgentOnlyMember => member != null);
  return roster.length === channel.memberIds.length && roster.every((member) => member.kind === 'agent');
}
