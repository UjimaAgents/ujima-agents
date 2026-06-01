import { describe, expect, it } from 'vitest';
import { MemberSchema } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import {
  assertGrantableOwnerFromParentOrg,
  assertGrantableOwnerFromMemberOrg,
  grantWorkspaceOwnerFromParentOrg,
} from './workspace-org-provision.js';

function createRepoStub(input: {
  humans: { id: string; name: string; hasAuthUser?: boolean; hasCredentials?: boolean }[];
}): ApiRepository {
  const members = input.humans.map((human) =>
    MemberSchema.parse({
      id: human.id,
      organizationId: 'parent-org',
      name: human.name,
      kind: 'human',
      roleName: human.id === 'owner' ? 'owner' : 'member',
      presence: 'offline',
    }),
  );

  return {
    listMembers: () => members,
    getAuthUserByMember: (_organizationId: string, memberId: string) => {
      const human = input.humans.find((entry) => entry.id === memberId);
      if (!human?.hasAuthUser) return null;
      return {
        id: `auth-${memberId}`,
        organizationId: 'parent-org',
        memberId,
        email: `${memberId}@example.com`,
        createdAt: new Date().toISOString(),
      };
    },
    getAuthUserCredentials: (_organizationId: string, email: string) => {
      const memberId = email.split('@')[0] ?? '';
      const human = input.humans.find((entry) => entry.id === memberId);
      if (!human?.hasCredentials) return null;
      return {
        user: {
          id: `auth-${memberId}`,
          organizationId: 'parent-org',
          memberId,
          email: `${memberId}@example.com`,
          createdAt: new Date().toISOString(),
        },
        passwordHash: 'hash',
        emailNormalized: email,
      };
    },
    saveMember: () => members[0]!,
    saveAuthUser: () => undefined,
  } as unknown as ApiRepository;
}

describe('grantWorkspaceOwnerFromParentOrg', () => {
  it('throws when the member owner has no login-capable credentials', () => {
    const repo = createRepoStub({
      humans: [{ id: 'human-no-auth', name: 'Human', hasAuthUser: false }],
    });

    expect(() =>
      assertGrantableOwnerFromMemberOrg(repo, 'parent-org', 'human-no-auth'),
    ).toThrow(/no login-capable human credentials/i);
  });

  it('throws when the parent org has no grantable human owner', () => {
    const repo = createRepoStub({
      humans: [{ id: 'human-no-auth', name: 'Human', hasAuthUser: false }],
    });

    expect(() => assertGrantableOwnerFromParentOrg(repo, 'parent-org')).toThrow(
      /no human member with login credentials/i,
    );
    expect(() =>
      grantWorkspaceOwnerFromParentOrg(repo, 'parent-org', 'child-org', 'child-owner'),
    ).toThrow(/no human member with login credentials/i);
  });

  it('seeds the child owner when a parent human has stored credentials', () => {
    const saved: { memberId?: string; organizationId?: string } = {};
    const repo = createRepoStub({
      humans: [
        {
          id: 'owner',
          name: 'Owner',
          hasAuthUser: true,
          hasCredentials: true,
        },
      ],
    });
    repo.saveMember = (member) => {
      saved.memberId = member.id;
      saved.organizationId = member.organizationId;
      return member;
    };
    repo.saveAuthUser = (input) => {
      saved.organizationId = input.user.organizationId;
      return input.user;
    };

    grantWorkspaceOwnerFromParentOrg(repo, 'parent-org', 'child-org', 'owner');

    expect(saved.organizationId).toBe('child-org');
    expect(saved.memberId).toBe('owner');
  });
});
