import { slugifyMemberId } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

export function resolveAgentMemberId(
  repo: ApiRepository,
  organizationId: string,
  displayName: string,
): string {
  const id = slugifyMemberId(displayName);
  if (!id) {
    throw new Error('Agent name must contain at least one letter or number');
  }

  const existing = repo.getMember(organizationId, id);
  if (existing && !existing.retiredAt) {
    throw new Error(`A member with the id "${id}" already exists`);
  }

  return id;
}
