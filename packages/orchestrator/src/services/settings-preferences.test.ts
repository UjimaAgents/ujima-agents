import { describe, expect, it } from 'vitest';
import { MemberSchema, OrganizationSchema, type Member } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import { SettingsService } from './settings.js';

describe('SettingsService.patchMemberPreferences member identity', () => {
  it('requires the canonical member id', () => {
    const members = new Map<string, Member>();
    const orgId = 'org-123';

    const quinn = MemberSchema.parse({
      id: 'quinn-mason',
      organizationId: orgId,
      name: 'Quinn Mason',
      kind: 'agent',
      roleName: 'backend-engineer',
      presence: 'offline',
    });
    members.set(quinn.id, quinn);

    const repo: Partial<ApiRepository> = {
      getOrganization: () => OrganizationSchema.parse({ id: orgId, name: 'Test Org', workspace: { folderPath: '/tmp' } }),
      getMember: (_orgId: string, id: string) => members.get(id) ?? null,
      listMembers: () => Array.from(members.values()),
      saveMember: (member: Member) => {
        members.set(member.id, member);
        return member;
      },
    };

    const service = new SettingsService(repo as ApiRepository);

    expect(() => service.patchMemberPreferences({
      organizationId: orgId,
      memberId: 'Quinn Mason',
      shellApprovalMode: 'auto_review',
    })).toThrow('Member not found');

    const updated = service.patchMemberPreferences({
      organizationId: orgId,
      memberId: 'quinn-mason',
      shellApprovalMode: 'auto_review',
    });
    expect(updated.id).toBe('quinn-mason');
    expect(updated.shellApprovalMode).toBe('auto_review');
  });
});
