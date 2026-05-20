import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { AuthSessionSchema, AuthUserSchema, type AuthSession, type AuthUser, type Member, type Organization } from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';

const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_KEYLEN = 64;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface AuthState {
  authenticated: boolean;
  user: AuthUser | null;
  member: Member | null;
  session: AuthSession | null;
}

export interface AuthenticatedSession extends AuthState {
  authenticated: true;
  user: AuthUser;
  member: Member;
  session: AuthSession;
  sessionToken: string;
}

export interface RegisterOwnerAuthInput {
  organizationId: string;
  memberId: string;
  email: string;
  password: string;
}

export interface LoginInput {
  organizationId?: string;
  email: string;
  password: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, PASSWORD_KEYLEN).toString('hex');
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, salt, expectedHex] = storedHash.split('$');
  if (scheme !== PASSWORD_HASH_PREFIX || !salt || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createSessionExpiry(from = Date.now()): string {
  return new Date(from + SESSION_TTL_MS).toISOString();
}

function unauthenticatedState(): AuthState {
  return {
    authenticated: false,
    user: null,
    member: null,
    session: null,
  };
}

export class AuthService {
  constructor(private readonly repo: ApiRepository) {}

  registerOwnerAccount(input: RegisterOwnerAuthInput): AuthenticatedSession {
    const member = this.repo.getMember(input.organizationId, input.memberId);
    if (!member) {
      throw new Error(`owner member "${input.memberId}" was not found`);
    }
    if (member.kind !== 'human') {
      throw new Error('only human members can receive owner credentials');
    }
    if (this.repo.getAuthUserByMember(input.organizationId, input.memberId)) {
      throw new Error(`member "${input.memberId}" already has credentials`);
    }

    const emailNormalized = normalizeEmail(input.email);
    if (!emailNormalized) {
      throw new Error('owner email is required');
    }
    if (this.repo.getAuthUserCredentials(input.organizationId, emailNormalized)) {
      throw new Error(`email "${input.email}" is already registered for this organization`);
    }

    const user = AuthUserSchema.parse({
      id: randomUUID(),
      organizationId: input.organizationId,
      memberId: input.memberId,
      email: input.email.trim(),
      createdAt: new Date().toISOString(),
    });

    this.repo.saveAuthUser({
      user,
      passwordHash: hashPassword(input.password),
      emailNormalized,
    });

    return this.issueSession(user, member);
  }

  login(input: LoginInput): AuthenticatedSession {
    const emailNormalized = normalizeEmail(input.email);
    const matches = input.organizationId
      ? [this.repo.getAuthUserCredentials(input.organizationId, emailNormalized)].filter(
          (match): match is NonNullable<typeof match> => match !== null,
        )
      : this.repo.findAuthUsersByEmail(emailNormalized);

    if (matches.length === 0) {
      throw new Error('invalid email or password');
    }
    if (matches.length > 1) {
      throw new Error('multiple organizations match this email; specify organizationId');
    }

    const match = matches[0];
    if (!match) {
      throw new Error('invalid email or password');
    }
    if (!verifyPassword(input.password, match.passwordHash)) {
      throw new Error('invalid email or password');
    }

    const member = this.repo.getMember(match.user.organizationId, match.user.memberId);
    if (!member) {
      throw new Error(`member "${match.user.memberId}" no longer exists`);
    }

    return this.issueSession(match.user, member);
  }

  getAuthState(sessionToken?: string | null): AuthState {
    if (!sessionToken) {
      return unauthenticatedState();
    }

    const record = this.repo.getAuthSessionByTokenHash(hashSessionToken(sessionToken));
    if (!record) {
      return unauthenticatedState();
    }

    const session = record.session;
    if (session.revokedAt) {
      return unauthenticatedState();
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      // Expired sessions are treated as revoked on read so repeated bootstrap
      // polling does not keep returning a stale token as "maybe valid".
      this.repo.revokeAuthSession(session.id, new Date().toISOString());
      return unauthenticatedState();
    }

    const user = this.repo.getAuthUserById(session.userId);
    const member = this.repo.getMember(session.organizationId, session.memberId);
    if (!user || !member) {
      return unauthenticatedState();
    }

    const touched = this.repo.touchAuthSession(session.id, new Date().toISOString()) ?? session;

    return {
      authenticated: true,
      user,
      member,
      session: touched,
    };
  }

  logout(sessionToken?: string | null): boolean {
    if (!sessionToken) return false;
    const record = this.repo.getAuthSessionByTokenHash(hashSessionToken(sessionToken));
    if (!record) return false;
    this.repo.revokeAuthSession(record.session.id, new Date().toISOString());
    return true;
  }

  switchOrganization(
    sessionToken: string | null | undefined,
    organizationId: string,
  ): AuthenticatedSession {
    const state = this.getAuthState(sessionToken);
    if (!state.authenticated || !state.user) {
      throw new Error('session required');
    }

    const emailNormalized = normalizeEmail(state.user.email);
    const credentials = this.repo.getAuthUserCredentials(organizationId, emailNormalized);
    if (!credentials) {
      throw new Error('you do not have access to this organization');
    }

    const member = this.repo.getMember(organizationId, credentials.user.memberId);
    if (!member) {
      throw new Error(`member "${credentials.user.memberId}" no longer exists`);
    }

    if (sessionToken) {
      this.logout(sessionToken);
    }

    return this.issueSession(credentials.user, member);
  }

  listAccessibleOrganizations(sessionToken?: string | null): Organization[] {
    const state = this.getAuthState(sessionToken);
    if (!state.authenticated || !state.user) return [];
    return this.repo.listOrganizationsForUser(
      state.user.email.trim().toLowerCase(),
    ).map((org) => ({ id: org.id, name: org.name } as Organization));
  }

  private issueSession(user: AuthUser, member: Member): AuthenticatedSession {
    const sessionToken = randomBytes(32).toString('hex');
    const issuedAt = Date.now();
    // The browser or web proxy keeps only this opaque token. The database
    // persists a one-way hash so a leaked SQLite file does not contain live
    // bearer-equivalent session values.
    const session = AuthSessionSchema.parse({
      id: randomUUID(),
      userId: user.id,
      organizationId: user.organizationId,
      memberId: user.memberId,
      createdAt: new Date(issuedAt).toISOString(),
      expiresAt: createSessionExpiry(issuedAt),
      lastSeenAt: new Date(issuedAt).toISOString(),
    });

    this.repo.saveAuthSession({
      session,
      sessionTokenHash: hashSessionToken(sessionToken),
    });

    return {
      authenticated: true,
      user,
      member,
      session,
      sessionToken,
    };
  }
}
