import { randomUUID } from 'node:crypto';
import { MemberSchema } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

/** Fixed human owner member id in every organization (multi-workspace identity). */
export const WORKSPACE_OWNER_MEMBER_ID = 'owner';

export function copyProviderCredentials(
  repo: ApiRepository,
  fromOrganizationId: string,
  toOrganizationId: string,
  providerNames?: string[],
): void {
  const available = repo.listProviderCredentials(fromOrganizationId);
  const names =
    providerNames === undefined ? Object.keys(available) : providerNames;
  for (const providerName of names) {
    const keyRef = repo.getProviderCredential(fromOrganizationId, providerName);
    if (keyRef) {
      repo.saveProviderCredential(toOrganizationId, providerName, keyRef);
    }
  }
}

function getGrantableMemberOwner(
  repo: ApiRepository,
  templateOrganizationId: string,
  templateMemberId: string,
): GrantableMemberOwner | null {
  const authUser = repo.getAuthUserByMember(templateOrganizationId, templateMemberId);
  if (!authUser) return null;
  const stored = repo.getAuthUserCredentials(
    templateOrganizationId,
    authUser.email.trim().toLowerCase(),
  );
  if (!stored) return null;

  const templateMember = repo.getMember(templateOrganizationId, templateMemberId);
  if (!templateMember || templateMember.kind !== 'human') return null;

  return { stored, templateMember };
}

interface GrantableMemberOwner {
  stored: NonNullable<ReturnType<ApiRepository['getAuthUserCredentials']>>;
  templateMember: { name: string };
}

export function assertGrantableOwnerFromMemberOrg(
  repo: ApiRepository,
  templateOrganizationId: string,
  templateMemberId: string,
): void {
  if (getGrantableMemberOwner(repo, templateOrganizationId, templateMemberId)) return;
  throw new Error('current user has no login-capable human credentials for this workspace');
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

/** Grants the current user access to a new org via their existing login (fixed owner member id). */
export function grantOrganizationAccessForMember(
  repo: ApiRepository,
  templateOrganizationId: string,
  templateMemberId: string,
  newOrganizationId: string,
): void {
  const grantable = getGrantableMemberOwner(repo, templateOrganizationId, templateMemberId);
  if (!grantable) {
    throw new Error('current user has no login-capable human credentials for this workspace');
  }

  saveWorkspaceOwner(
    repo,
    grantable.stored,
    newOrganizationId,
    WORKSPACE_OWNER_MEMBER_ID,
    grantable.templateMember.name,
  );
}

/** @deprecated Use grantOrganizationAccessForMember */
export const grantWorkspaceOwnerForMember = grantOrganizationAccessForMember;

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
