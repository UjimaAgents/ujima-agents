import type {
  Member,
  Organization,
  Spirit,
  WorkspaceMember,
} from '@ujima/shared';

/**
 * Narrow port for member + organization + spirit operations.
 */
export interface MemberStore {
  // Organization
  getOrganization(organizationId: string): Organization | null;
  listOrganizations(): Organization[];
  saveOrganization(organization: Organization): Organization;
  saveWorkspaceSetting(
    organizationId: string,
    key: string,
    value: string,
  ): void;
  getWorkspaceSetting(
    organizationId: string,
    key: string,
  ): string | null;
  deleteWorkspaceSetting(
    organizationId: string,
    key: string,
  ): void;

  // Members
  saveMember(member: Member): Member;
  saveWorkspaceMember(
    workspaceMember: WorkspaceMember,
  ): WorkspaceMember;
  getMember(organizationId: string, memberId: string): Member | null;
  listMembers(organizationId: string): Member[];
  getWorkspaceMember(
    organizationId: string,
    memberId: string,
  ): WorkspaceMember | null;
  listWorkspaceMembers(organizationId: string): WorkspaceMember[];

  // Spirits
  saveSpirit(spirit: Spirit): Spirit;
  getSpiritByTriple(
    organizationId: string,
    taskSessionId: string,
    memberId: string,
    role: string,
  ): Spirit | null;
  listActiveSpiritsForMember(
    organizationId: string,
    memberId: string,
  ): Spirit[];
  listSpiritsForSession(
    organizationId: string,
    taskSessionId: string,
  ): Spirit[];

  // Task Sessions
  getTaskSession(
    organizationId: string,
    taskSessionId: string,
  ): { id: string; channelId: string; slug: string; status: string; prompt?: string } | null;
}
