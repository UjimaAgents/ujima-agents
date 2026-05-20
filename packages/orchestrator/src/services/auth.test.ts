import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.js';
import type { ApiRepository } from './repository-reader.js';

describe('AuthService', () => {
  it('does not list organizations for expired sessions', () => {
    const revokeAuthSession = vi.fn();
    const repo = {
      getAuthSessionByTokenHash: vi.fn().mockReturnValue({
        session: {
          id: 'session-1',
          userId: 'user-1',
          organizationId: 'org-1',
          memberId: 'member-1',
          expiresAt: '2020-01-01T00:00:00.000Z',
        },
        sessionTokenHash: 'hash',
      }),
      revokeAuthSession,
      getAuthUserById: vi.fn(),
      getMember: vi.fn(),
      listOrganizationsForUser: vi.fn(),
    } as unknown as ApiRepository;

    const auth = new AuthService(repo);
    expect(auth.listAccessibleOrganizations('token')).toEqual([]);
    expect(revokeAuthSession).toHaveBeenCalledWith('session-1', expect.any(String));
  });
});
