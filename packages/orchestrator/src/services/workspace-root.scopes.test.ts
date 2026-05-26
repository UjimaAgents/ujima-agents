import { describe, expect, it } from 'vitest';
import type { AgentTeamHandle } from '@ujima/framework';
import type { WorkspaceMember } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import { ensureWorkspaceMemberScopes, upsertWorkspaceMemberScopes } from './workspace-root.js';

function createRepo(initial?: WorkspaceMember): ApiRepository {
  let member = initial;
  return {
    getWorkspaceMember: () => member,
    saveWorkspaceMember: (payload: WorkspaceMember) => {
      member = payload;
      return payload;
    },
  } as unknown as ApiRepository;
}

function createTeam(scopes: string[]): AgentTeamHandle {
  return {
    getRole: () => ({
      workspaceScopes: scopes,
    }),
  } as unknown as AgentTeamHandle;
}

describe('ensureWorkspaceMemberScopes', () => {
  it('syncs stored scopes when the role definition changes', () => {
    const repo = createRepo({
      organizationId: 'org-1',
      memberId: 'ethan',
      roleScopePaths: ['apps/web'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const team = createTeam(['apps/web', 'packages']);

    const updated = ensureWorkspaceMemberScopes(repo, team, 'org-1', 'ethan', 'frontend-engineer');

    expect(updated.roleScopePaths).toEqual(['apps/web', 'packages']);
  });

  it('returns the existing row when scopes already match', () => {
    const existing = upsertWorkspaceMemberScopes(
      createRepo(),
      'org-1',
      'ethan',
      ['apps/web'],
    );
    const repo = createRepo(existing);
    const team = createTeam(['apps/web']);

    const result = ensureWorkspaceMemberScopes(repo, team, 'org-1', 'ethan', 'frontend-engineer');

    expect(result).toBe(existing);
  });
});
