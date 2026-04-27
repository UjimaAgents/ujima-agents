import type { SqliteDbHandle as DbHandle } from '@ujima/context-store';
import { AuthSessionSchema, AuthUserSchema, type AuthSession, type AuthUser } from '@ujima/shared';
import { now, optionalRowString, rowString } from './common.js';

type Row = Record<string, unknown>;

export interface StoredAuthUser {
  user: AuthUser;
  passwordHash: string;
  emailNormalized: string;
}

export interface StoredAuthSession {
  session: AuthSession;
  sessionTokenHash: string;
}

function rowToAuthUser(row: Row): AuthUser {
  return AuthUserSchema.parse({
    id: rowString(row, 'id'),
    organizationId: rowString(row, 'organization_id'),
    memberId: rowString(row, 'member_id'),
    email: rowString(row, 'email'),
    createdAt: optionalRowString(row, 'created_at'),
    updatedAt: optionalRowString(row, 'updated_at'),
  });
}

function rowToStoredAuthUser(row: Row): StoredAuthUser {
  return {
    user: rowToAuthUser(row),
    passwordHash: rowString(row, 'password_hash'),
    emailNormalized: rowString(row, 'email_normalized'),
  };
}

function rowToAuthSession(row: Row): AuthSession {
  return AuthSessionSchema.parse({
    id: rowString(row, 'id'),
    userId: rowString(row, 'user_id'),
    organizationId: rowString(row, 'organization_id'),
    memberId: rowString(row, 'member_id'),
    createdAt: optionalRowString(row, 'created_at'),
    expiresAt: rowString(row, 'expires_at'),
    lastSeenAt: optionalRowString(row, 'last_seen_at'),
    revokedAt: optionalRowString(row, 'revoked_at'),
  });
}

function rowToStoredAuthSession(row: Row): StoredAuthSession {
  return {
    session: rowToAuthSession(row),
    sessionTokenHash: rowString(row, 'session_token_hash'),
  };
}

export function saveAuthUser(
  db: DbHandle,
  input: StoredAuthUser,
): AuthUser {
  const timestamp = now();
  const payload = AuthUserSchema.parse(input.user);

  db.prepare(
    `INSERT INTO auth_users (
      id,
      organization_id,
      member_id,
      email,
      email_normalized,
      password_hash,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      member_id = excluded.member_id,
      email = excluded.email,
      email_normalized = excluded.email_normalized,
      password_hash = excluded.password_hash,
      updated_at = excluded.updated_at`,
  ).run(
    payload.id,
    payload.organizationId,
    payload.memberId,
    payload.email,
    input.emailNormalized,
    input.passwordHash,
    payload.createdAt ?? timestamp,
    timestamp,
  );

  return payload;
}

export function getAuthUserById(db: DbHandle, userId: string): AuthUser | null {
  const row = db.prepare('SELECT * FROM auth_users WHERE id = ?').get(userId) as Row | null;
  return row ? rowToAuthUser(row) : null;
}

export function getAuthUserByMember(
  db: DbHandle,
  organizationId: string,
  memberId: string,
): AuthUser | null {
  const row = db
    .prepare('SELECT * FROM auth_users WHERE organization_id = ? AND member_id = ?')
    .get(organizationId, memberId) as Row | null;
  return row ? rowToAuthUser(row) : null;
}

export function getAuthUserCredentials(
  db: DbHandle,
  organizationId: string,
  emailNormalized: string,
): StoredAuthUser | null {
  const row = db
    .prepare(
      'SELECT * FROM auth_users WHERE organization_id = ? AND email_normalized = ?',
    )
    .get(organizationId, emailNormalized) as Row | null;
  return row ? rowToStoredAuthUser(row) : null;
}

export function findAuthUsersByEmail(
  db: DbHandle,
  emailNormalized: string,
): StoredAuthUser[] {
  const rows = db
    .prepare('SELECT * FROM auth_users WHERE email_normalized = ? ORDER BY created_at ASC')
    .all(emailNormalized) as Row[];
  return rows.map(rowToStoredAuthUser);
}

export function saveAuthSession(
  db: DbHandle,
  input: StoredAuthSession,
): AuthSession {
  const timestamp = now();
  const payload = AuthSessionSchema.parse(input.session);

  db.prepare(
    `INSERT INTO auth_sessions (
      id,
      user_id,
      organization_id,
      member_id,
      session_token_hash,
      created_at,
      expires_at,
      last_seen_at,
      revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      expires_at = excluded.expires_at,
      last_seen_at = excluded.last_seen_at,
      revoked_at = excluded.revoked_at`,
  ).run(
    payload.id,
    payload.userId,
    payload.organizationId,
    payload.memberId,
    input.sessionTokenHash,
    payload.createdAt ?? timestamp,
    payload.expiresAt,
    payload.lastSeenAt ?? timestamp,
    payload.revokedAt ?? null,
  );

  return payload;
}

export function getAuthSessionByTokenHash(
  db: DbHandle,
  sessionTokenHash: string,
): StoredAuthSession | null {
  const row = db
    .prepare('SELECT * FROM auth_sessions WHERE session_token_hash = ?')
    .get(sessionTokenHash) as Row | null;
  return row ? rowToStoredAuthSession(row) : null;
}

export function revokeAuthSession(
  db: DbHandle,
  sessionId: string,
  revokedAt = now(),
): AuthSession | null {
  const row = db
    .prepare('SELECT * FROM auth_sessions WHERE id = ?')
    .get(sessionId) as Row | null;
  if (!row) return null;

  db.prepare(
    'UPDATE auth_sessions SET revoked_at = ?, last_seen_at = ? WHERE id = ?',
  ).run(revokedAt, revokedAt, sessionId);

  return rowToAuthSession({ ...row, revoked_at: revokedAt, last_seen_at: revokedAt });
}

export function touchAuthSession(
  db: DbHandle,
  sessionId: string,
  lastSeenAt = now(),
): AuthSession | null {
  const row = db
    .prepare('SELECT * FROM auth_sessions WHERE id = ?')
    .get(sessionId) as Row | null;
  if (!row) return null;

  db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(lastSeenAt, sessionId);
  return rowToAuthSession({ ...row, last_seen_at: lastSeenAt });
}
