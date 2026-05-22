import { randomUUID } from 'node:crypto';
import { MemberSchema } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

export function orgWorkspaceId(organizationId: string): string {
  return `ws_${organizationId}`;
}

export function organizationIdFromWorkspaceId(workspaceId: string): string | null {
  if (!workspaceId.startsWith('ws_') || workspaceId.length <= 3) return null;
  return workspaceId.slice(3);
}

export function copyProviderCredentials(
  repo: ApiRepository,
  fromOrganizationId: string,
  toOrganizationId: string,
): void {
  const providers = repo.listProviderCredentials(fromOrganizationId);
  for (const providerName of Object.keys(providers)) {
    const keyRef = repo.getProviderCredential(fromOrganizationId, providerName);
    if (keyRef) {
      repo.saveProviderCredential(toOrganizationId, providerName, keyRef);
    }
  }
}

function saveWorkspaceOwner(
  repo: ApiRepository,
  stored: NonNullable<ReturnType<ApiRepository['getAuthUserCredentials']>>,
  newOrganizationId: string,
  ownerMemberId: string,
  ownerName: string,
): void {
  const owner = MemberSchema.parse({
    id: ownerMemberId,
    organizationId: newOrganizationId,
    name: ownerName,
    kind: 'human',
    roleName: 'owner',
    presence: 'offline',
    createdAt: new Date().toISOString(),
  });
  repo.saveMember(owner);
  repo.saveAuthUser({
    user: {
      ...stored.user,
      id: randomUUID(),
      organizationId: newOrganizationId,
      memberId: ownerMemberId,
    },
    passwordHash: stored.passwordHash,
    emailNormalized: stored.emailNormalized,
  });
}

export function grantWorkspaceOwnerForMember(
  repo: ApiRepository,
  templateOrganizationId: string,
  templateMemberId: string,
  newOrganizationId: string,
): void {
  const authUser = repo.getAuthUserByMember(templateOrganizationId, templateMemberId);
  if (!authUser) {
    throw new Error('current user has no credentials for this workspace');
  }
  const stored = repo.getAuthUserCredentials(
    templateOrganizationId,
    authUser.email.trim().toLowerCase(),
  );
  if (!stored) {
    throw new Error('current user credentials were not found');
  }

  const templateMember = repo.getMember(templateOrganizationId, templateMemberId);
  if (!templateMember || templateMember.kind !== 'human') {
    throw new Error('only human members can own a workspace');
  }

  saveWorkspaceOwner(
    repo,
    stored,
    newOrganizationId,
    randomUUID(),
    templateMember.name,
  );
}

interface GrantableParentOwner {
  stored: NonNullable<ReturnType<ApiRepository['getAuthUserCredentials']>>;
  parentMember: { id: string; name: string };
}

function findGrantableParentOwner(
  repo: ApiRepository,
  parentOrganizationId: string,
): GrantableParentOwner | null {
  const humans = repo.listMembers(parentOrganizationId).filter((m) => m.kind === 'human');
  const ordered = [
    ...humans.filter((m) => m.roleName === 'owner'),
    ...humans.filter((m) => m.roleName !== 'owner'),
  ];
  for (const parentMember of ordered) {
    const authUser = repo.getAuthUserByMember(parentOrganizationId, parentMember.id);
    if (!authUser) continue;
    const stored = repo.getAuthUserCredentials(
      parentOrganizationId,
      authUser.email.trim().toLowerCase(),
    );
    if (!stored) continue;
    return { stored, parentMember };
  }
  return null;
}

export function assertGrantableOwnerFromParentOrg(
  repo: ApiRepository,
  parentOrganizationId: string,
): void {
  if (findGrantableParentOwner(repo, parentOrganizationId)) return;
  throw new Error(
    `parent organization "${parentOrganizationId}" has no human member with login credentials to seed a workspace owner`,
  );
}

export function grantWorkspaceOwnerFromParentOrg(
  repo: ApiRepository,
  parentOrganizationId: string,
  newOrganizationId: string,
  ownerMemberId: string,
): void {
  const eligible = findGrantableParentOwner(repo, parentOrganizationId);
  if (!eligible) {
    throw new Error(
      `parent organization "${parentOrganizationId}" has no human member with login credentials to seed a workspace owner`,
    );
  }
  saveWorkspaceOwner(
    repo,
    eligible.stored,
    newOrganizationId,
    ownerMemberId,
    eligible.parentMember.name,
  );
}
