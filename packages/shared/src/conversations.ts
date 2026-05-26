/** Workspace catalog id for the 1:1 organization model (`ws_{organizationId}`). */
export function orgWorkspaceId(organizationId: string): string {
  return `ws_${organizationId}`;
}

export function organizationIdFromWorkspaceId(workspaceId: string): string | null {
  if (!workspaceId.startsWith('ws_') || workspaceId.length <= 3) return null;
  return workspaceId.slice(3);
}

export function getDirectMessageThreadId(senderId: string, recipientId: string): string {
  const [firstId, secondId] = [senderId, recipientId].sort();
  return `dm:${firstId}:${secondId}`;
}

export function isDirectMessageThread(threadId: string | undefined): boolean {
  return !!threadId?.startsWith('dm:');
}

export interface DmThreadParticipants {
  participantA: string;
  participantB: string;
}

/** Parses `dm:{idA}:{idB}` thread ids. Returns null when the shape is invalid. */
export function parseDmThreadId(threadId: string): DmThreadParticipants | null {
  if (!isDirectMessageThread(threadId)) return null;
  const [, firstId, secondId] = threadId.split(':', 3);
  if (!firstId || !secondId) return null;
  return { participantA: firstId, participantB: secondId };
}

/** Other participant in a DM thread for `currentMemberId`, if they are a member of the thread. */
export function resolveDmPeerMemberId(threadId: string, currentMemberId: string): string | undefined {
  const parsed = parseDmThreadId(threadId);
  if (!parsed) return undefined;
  if (parsed.participantA === currentMemberId) return parsed.participantB;
  if (parsed.participantB === currentMemberId) return parsed.participantA;
  return undefined;
}

export function normalizeDmChannelRef(channelRef: string, currentMemberId: string): string {
  const trimmed = channelRef.trim();
  if (parseDmThreadId(trimmed)) {
    return trimmed;
  }

  const singleParticipant = /^dm:([^:]+)$/i.exec(trimmed);
  if (singleParticipant?.[1]) {
    return getDirectMessageThreadId(currentMemberId, singleParticipant[1]);
  }

  return trimmed;
}
