import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

interface StatementHandle {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number };
}

export interface DbHandle {
  prepare(sql: string): StatementHandle;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  close(): void;
}

type SqliteDatabaseCtor = new (path: string) => DbHandle;

// Resolve the SQLite driver lazily so the import surface stays clean for
// both runtimes:
//   * bun → `bun:sqlite` (native, fast)
//   * node → `better-sqlite3`
// `createRequire(__filename)` keeps it synchronous (no top-level await) and
// avoids the `require()`/`any` lint hits that the previous shim took.
// `__filename` is used instead of `import.meta.url` because this package
// emits CommonJS (no `"type": "module"` on its package.json).
const requireSqlite = createRequire(__filename);
let cachedConstructor: SqliteDatabaseCtor | undefined;

function resolveDatabaseConstructor(): SqliteDatabaseCtor {
  if (cachedConstructor) return cachedConstructor;
  const isBun = typeof process !== 'undefined' && Boolean(process.versions?.bun);
  cachedConstructor = isBun
    ? (requireSqlite('bun:sqlite') as { Database: SqliteDatabaseCtor }).Database
    : (requireSqlite('better-sqlite3') as SqliteDatabaseCtor);
  return cachedConstructor;
}

const MIGRATIONS: { id: string; up: string }[] = [
  {
    id: '001_initial',
    up: `
      CREATE TABLE IF NOT EXISTS context_entries (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_updated ON context_entries(updated_at);

      CREATE TABLE IF NOT EXISTS audit_events (
        id            TEXT PRIMARY KEY,
        event_id      TEXT NOT NULL,
        event_type    TEXT NOT NULL,
        agent_id      TEXT NOT NULL,
        task_id       TEXT NOT NULL,
        session_id    TEXT NOT NULL,
        tool_name     TEXT,
        tool_input    TEXT,
        tool_output   TEXT,
        allowed       INTEGER NOT NULL,
        block_reason  TEXT,
        tokens_used   INTEGER,
        duration_ms   INTEGER,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_agent   ON audit_events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_task    ON audit_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);

      CREATE TABLE IF NOT EXISTS agent_state (
        agent_id        TEXT PRIMARY KEY,
        status          TEXT NOT NULL,
        last_action     TEXT,
        last_heartbeat  INTEGER,
        tokens_used     INTEGER NOT NULL DEFAULT 0,
        calls_made      INTEGER NOT NULL DEFAULT 0,
        updated_at      INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS task_state (
        task_id     TEXT PRIMARY KEY,
        status      TEXT NOT NULL,
        started_at  INTEGER NOT NULL,
        ended_at    INTEGER,
        metadata    TEXT
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id            TEXT PRIMARY KEY,
        task_id       TEXT NOT NULL,
        artifact_key  TEXT NOT NULL,
        domain        TEXT NOT NULL,
        status        TEXT NOT NULL,
        proposed_by   TEXT,
        approved_by   TEXT,
        decided_at    INTEGER,
        reason        TEXT,
        created_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_task   ON approvals(task_id);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);

      CREATE TABLE IF NOT EXISTS pending_events (
        id             TEXT PRIMARY KEY,
        channel        TEXT NOT NULL,
        event_payload  TEXT NOT NULL,
        created_at     INTEGER NOT NULL,
        expires_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pending_channel ON pending_events(channel);
      CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_events(expires_at);

      CREATE TABLE IF NOT EXISTS schema_migrations (
        id        TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: '002_workspaces',
    up: `
      CREATE TABLE IF NOT EXISTS workspaces (
        id          TEXT PRIMARY KEY,
        root_path   TEXT,
        label       TEXT,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_workspaces_root ON workspaces(root_path);

      CREATE TABLE IF NOT EXISTS runtime_state (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `,
  },
  {
    id: '003_org_mode_core',
    up: `
      ALTER TABLE audit_events RENAME TO task_audit_events;
      ALTER TABLE approvals    RENAME TO task_approvals;

      CREATE TABLE IF NOT EXISTS organizations (
        id                       TEXT PRIMARY KEY,
        name                     TEXT NOT NULL,
        workspace_root           TEXT NOT NULL,
        workspace_role_scopes    TEXT NOT NULL DEFAULT '{}',
        organization_chart_json  TEXT NOT NULL DEFAULT '{"reportsTo":{}}',
        created_at               TEXT NOT NULL,
        updated_at               TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspace_settings (
        organization_id  TEXT NOT NULL,
        key              TEXT NOT NULL,
        value            TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (organization_id, key)
      );

      CREATE TABLE IF NOT EXISTS members (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        name             TEXT NOT NULL,
        kind             TEXT NOT NULL,
        role_name        TEXT NOT NULL,
        presence         TEXT NOT NULL DEFAULT 'offline',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_members_org ON members(organization_id);

      CREATE TABLE IF NOT EXISTS channels (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        name             TEXT NOT NULL,
        kind             TEXT NOT NULL,
        topic            TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_channels_org ON channels(organization_id);

      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id  TEXT NOT NULL,
        member_id   TEXT NOT NULL,
        PRIMARY KEY (channel_id, member_id)
      );

      CREATE TABLE IF NOT EXISTS threads (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        channel_id       TEXT,
        title            TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_threads_org     ON threads(organization_id);
      CREATE INDEX IF NOT EXISTS idx_threads_channel ON threads(channel_id);

      CREATE TABLE IF NOT EXISTS thread_members (
        thread_id  TEXT NOT NULL,
        member_id  TEXT NOT NULL,
        PRIMARY KEY (thread_id, member_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        thread_id        TEXT NOT NULL,
        channel_id       TEXT,
        sender_id        TEXT NOT NULL,
        sender_kind      TEXT NOT NULL,
        kind             TEXT NOT NULL,
        content          TEXT NOT NULL,
        mentions         TEXT NOT NULL DEFAULT '[]',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_org     ON messages(organization_id);

      CREATE TABLE IF NOT EXISTS runs (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        agent_id         TEXT NOT NULL,
        thread_id        TEXT,
        status           TEXT NOT NULL,
        step             TEXT NOT NULL DEFAULT '',
        summary          TEXT NOT NULL DEFAULT '',
        started_at       TEXT NOT NULL,
        ended_at         TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_org ON runs(organization_id, started_at);

      CREATE TABLE IF NOT EXISTS approvals (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        run_id           TEXT,
        requested_by     TEXT NOT NULL,
        resource_type    TEXT NOT NULL,
        resource_path    TEXT NOT NULL,
        action           TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending',
        reason           TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL,
        resolved_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_approvals_org     ON approvals(organization_id, status);
      CREATE INDEX IF NOT EXISTS idx_approvals_run     ON approvals(run_id);

      CREATE TABLE IF NOT EXISTS audit_events (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        actor_id         TEXT,
        action           TEXT NOT NULL,
        target_type      TEXT NOT NULL,
        target_id        TEXT,
        status           TEXT NOT NULL DEFAULT 'ok',
        metadata         TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events(organization_id, created_at);

      CREATE TABLE IF NOT EXISTS memory_entries (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        member_id        TEXT,
        kind             TEXT NOT NULL,
        content          TEXT NOT NULL,
        metadata         TEXT NOT NULL DEFAULT '{}',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_entries_org ON memory_entries(organization_id);

      CREATE TABLE IF NOT EXISTS provider_credentials (
        organization_id  TEXT NOT NULL,
        provider_name    TEXT NOT NULL,
        key_ref          TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        PRIMARY KEY (organization_id, provider_name)
      );

      CREATE TABLE IF NOT EXISTS tool_activity (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        run_id           TEXT NOT NULL,
        tool_id          TEXT NOT NULL,
        action           TEXT NOT NULL,
        input            TEXT NOT NULL,
        output           TEXT,
        status           TEXT NOT NULL,
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tool_activity_run ON tool_activity(run_id, created_at);
    `,
  },
  {
    id: '004_additive_ports',
    up: `
      ALTER TABLE messages ADD COLUMN tool_calls TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE IF NOT EXISTS workspace_members (
        organization_id   TEXT NOT NULL,
        member_id         TEXT NOT NULL,
        role_scope_paths  TEXT NOT NULL DEFAULT '[]',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (organization_id, member_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_members_org ON workspace_members(organization_id);

      CREATE TABLE IF NOT EXISTS todos (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        run_id           TEXT,
        member_id        TEXT NOT NULL,
        title            TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'pending',
        notes            TEXT NOT NULL DEFAULT '',
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_todos_org    ON todos(organization_id, status);
      CREATE INDEX IF NOT EXISTS idx_todos_run    ON todos(run_id);
      CREATE INDEX IF NOT EXISTS idx_todos_member ON todos(member_id);

      CREATE TABLE IF NOT EXISTS provider_bindings (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        provider         TEXT NOT NULL,
        model            TEXT NOT NULL,
        scope            TEXT NOT NULL DEFAULT 'workspace',
        scope_ref        TEXT,
        api_key_ref      TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_provider_bindings_org
        ON provider_bindings(organization_id, provider);
    `,
  },
  {
    id: '005_config_reconcile',
    up: `
      ALTER TABLE members ADD COLUMN retired_at TEXT;
      ALTER TABLE channels ADD COLUMN archived_at TEXT;

      CREATE TABLE IF NOT EXISTS config_field_ownership (
        organization_id          TEXT NOT NULL,
        entity_type              TEXT NOT NULL,
        entity_id                TEXT NOT NULL,
        field_name               TEXT NOT NULL,
        owner                    TEXT NOT NULL DEFAULT 'dashboard',
        allow_dashboard_override INTEGER NOT NULL DEFAULT 0,
        updated_at               TEXT NOT NULL,
        PRIMARY KEY (organization_id, entity_type, entity_id, field_name)
      );
      CREATE INDEX IF NOT EXISTS idx_config_field_ownership_org
        ON config_field_ownership(organization_id, entity_type, entity_id);
    `,
  },
  {
    id: '006_channels_v2',
    up: `
      ALTER TABLE channels ADD COLUMN parent_message_id TEXT;
      ALTER TABLE messages ADD COLUMN parent_message_id TEXT;
      ALTER TABLE messages ADD COLUMN edited_at TEXT;
      ALTER TABLE messages ADD COLUMN deleted_at TEXT;

      CREATE TABLE IF NOT EXISTS message_mentions (
        id          TEXT PRIMARY KEY,
        message_id  TEXT NOT NULL,
        member_id   TEXT NOT NULL,
        kind        TEXT NOT NULL DEFAULT 'mention',
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_message_mentions_message
        ON message_mentions(message_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_message_mentions_member
        ON message_mentions(member_id, created_at);

      -- Preserve mention metadata for rows written before message_mentions
      -- existed by backfilling from the legacy JSON messages.mentions array.
      INSERT INTO message_mentions (id, message_id, member_id, kind, created_at)
      SELECT
        m.id || ':' || CAST(j.key AS TEXT),
        m.id,
        CAST(j.value AS TEXT),
        'mention',
        m.created_at
      FROM messages m
      JOIN json_each(CASE WHEN json_valid(m.mentions) THEN m.mentions ELSE '[]' END) j
      WHERE j.type = 'text'
        AND NOT EXISTS (
          SELECT 1
          FROM message_mentions mm
          WHERE mm.message_id = m.id
        );

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        body,
        content='messages',
        content_rowid='rowid'
      );

      INSERT INTO messages_fts(rowid, body)
      SELECT rowid, content FROM messages;

      CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, body) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.content);
      END;
    `,
  },
  {
    id: '007_member_llm_model',
    up: `
      ALTER TABLE members ADD COLUMN llm TEXT;
      ALTER TABLE members ADD COLUMN model TEXT;
    `,
  },
  {
    id: '007_auth',
    up: `
      CREATE TABLE IF NOT EXISTS auth_users (
        id                TEXT PRIMARY KEY,
        organization_id   TEXT NOT NULL,
        member_id         TEXT NOT NULL,
        email             TEXT NOT NULL,
        email_normalized  TEXT NOT NULL,
        password_hash     TEXT NOT NULL,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        UNIQUE (organization_id, member_id),
        UNIQUE (organization_id, email_normalized)
      );
      CREATE INDEX IF NOT EXISTS idx_auth_users_email
        ON auth_users(email_normalized);
      CREATE INDEX IF NOT EXISTS idx_auth_users_member
        ON auth_users(organization_id, member_id);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id                  TEXT PRIMARY KEY,
        user_id             TEXT NOT NULL,
        organization_id     TEXT NOT NULL,
        member_id           TEXT NOT NULL,
        session_token_hash  TEXT NOT NULL UNIQUE,
        created_at          TEXT NOT NULL,
        expires_at          TEXT NOT NULL,
        last_seen_at        TEXT NOT NULL,
        revoked_at          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
        ON auth_sessions(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_member
        ON auth_sessions(organization_id, member_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
        ON auth_sessions(expires_at);
    `,
  },
  {
    id: '008_task_sessions',
    up: `
      -- Phase 1 of the unified task shell. A task_session is the parent
      -- aggregate above per-agent RunState rows: one session per piece of
      -- work, one task-run channel pinned to it, multiple worker runs
      -- linked back via runs.task_session_id (added in a follow-up
      -- migration when the worker loop lands).
      CREATE TABLE IF NOT EXISTS task_sessions (
        id              TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        slug            TEXT NOT NULL,
        channel_id      TEXT NOT NULL,
        requested_by    TEXT NOT NULL,
        execution_mode  TEXT NOT NULL DEFAULT 'concurrent',
        status          TEXT NOT NULL DEFAULT 'queued',
        prompt          TEXT NOT NULL DEFAULT '',
        summary         TEXT NOT NULL DEFAULT '',
        team_member_ids TEXT NOT NULL DEFAULT '[]',
        origin_channel_id TEXT,
        origin_message_id TEXT,
        promotion_metadata TEXT NOT NULL DEFAULT '{}',
        supervisor_turn_count INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        completed_at    TEXT,
        UNIQUE (organization_id, slug),
        UNIQUE (channel_id)
      );
      CREATE INDEX IF NOT EXISTS idx_task_sessions_org_status
        ON task_sessions(organization_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_sessions_org_created
        ON task_sessions(organization_id, created_at DESC, id DESC);
    `,
  },
  {
    id: '009_spirits',
    up: `
      -- Phase 2.A — spirits table.
      --
      -- A "spirit" is the per-{task_session_id, member_id, role} runtime
      -- instance that drives an agent through a task session. The two
      -- roles split distinct concerns:
      --   role='worker'      — multi-turn loop that owns the work
      --   role='supervisor'  — lazy DM/@mention answerer on a cheaper
      --                        tier with a strict tool allowlist
      --
      -- Spirits are sticky to the (session, member, role) triple — re-
      -- spawning the same combination resumes the existing row instead
      -- of creating a duplicate. UNIQUE enforces the invariant at the
      -- DB layer so two parallel start() calls can't race past each
      -- other.
      CREATE TABLE IF NOT EXISTS spirits (
        id              TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        task_session_id TEXT NOT NULL,
        member_id       TEXT NOT NULL,
        role            TEXT NOT NULL DEFAULT 'worker',
        run_id          TEXT,
        status          TEXT NOT NULL DEFAULT 'queued',
        iteration       INTEGER NOT NULL DEFAULT 0,
        tokens_used     INTEGER NOT NULL DEFAULT 0,
        last_message_id TEXT,
        last_error      TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        ended_at        TEXT,
        UNIQUE (task_session_id, member_id, role)
      );
      CREATE INDEX IF NOT EXISTS idx_spirits_org_status
        ON spirits(organization_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_spirits_session
        ON spirits(task_session_id, role);
      CREATE INDEX IF NOT EXISTS idx_spirits_member
        ON spirits(member_id, status);
    `,
  },
  {
    id: '010_supervisor_todos',
    up: `
      -- Phase 2.B — extend the existing todos table (introduced in
      -- migration 004_additive_ports) with a task_session_id pointer
      -- so the supervisor.todo.* tools can scope reads/writes to the
      -- active task without leaking across sessions.
      --
      -- Pre-existing todos rows continue to work with NULL — the
      -- supervisor surface only writes scoped rows, but legacy
      -- callers of the table aren't affected.
      ALTER TABLE todos ADD COLUMN task_session_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_todos_task_session ON todos(task_session_id);
    `,
  },
  {
    id: '011_approval_tool_call_id',
    up: `
      ALTER TABLE approvals ADD COLUMN tool_call_id TEXT;
    `,
  },
  {
    id: '012_attachments',
    up: `
      CREATE TABLE IF NOT EXISTS attachments (
        id              TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        filename        TEXT NOT NULL,
        mime_type       TEXT NOT NULL,
        category        TEXT NOT NULL,
        size_bytes      INTEGER NOT NULL,
        storage_path    TEXT NOT NULL,
        uploaded_by     TEXT NOT NULL,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attachments_org
        ON attachments(organization_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS message_attachments (
        message_id    TEXT NOT NULL,
        attachment_id TEXT NOT NULL,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (message_id, attachment_id),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_message_attachments_message
        ON message_attachments(message_id);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_attachment
        ON message_attachments(attachment_id);
    `,
  },
  {
    id: '013_conversation_reads',
    up: `
      CREATE TABLE IF NOT EXISTS conversation_reads (
        organization_id  TEXT NOT NULL,
        member_id        TEXT NOT NULL,
        thread_id        TEXT NOT NULL,
        last_read_at     TEXT NOT NULL,
        PRIMARY KEY (organization_id, member_id, thread_id)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_reads_member
        ON conversation_reads(organization_id, member_id, thread_id);
    `,
  },
  {
    id: '014_run_steps',
    up: `
      CREATE TABLE IF NOT EXISTS run_steps (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        run_id           TEXT NOT NULL,
        thread_id        TEXT,
        agent_id         TEXT NOT NULL,
        tool_call_id     TEXT NOT NULL,
        tool_id          TEXT NOT NULL,
        action           TEXT NOT NULL,
        resource_type    TEXT NOT NULL,
        resource_path    TEXT NOT NULL DEFAULT '',
        input            TEXT NOT NULL DEFAULT '{}',
        output           TEXT,
        status           TEXT NOT NULL DEFAULT 'ok',
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_steps_run
        ON run_steps(organization_id, run_id, created_at);
    `,
  },
  {
    id: '016_approval_thread_id',
    up: `
      ALTER TABLE approvals ADD COLUMN thread_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_approvals_thread
        ON approvals(organization_id, thread_id, status);
    `,
  },
  {
    id: '017_drop_thread_dispositions',
    up: `
      DROP TABLE IF EXISTS thread_dispositions;
    `,
  },
  {
    id: '018_scheduled_jobs',
    up: `
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id               TEXT PRIMARY KEY,
        organization_id  TEXT NOT NULL,
        name             TEXT NOT NULL,
        cron_expression  TEXT NOT NULL,
        prompt           TEXT NOT NULL,
        channel_id       TEXT,
        member_id        TEXT NOT NULL,
        status           TEXT NOT NULL DEFAULT 'active',
        last_run_at      TEXT,
        next_run_at      TEXT,
        run_count        INTEGER NOT NULL DEFAULT 0,
        last_error       TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_org
        ON scheduled_jobs(organization_id, status, next_run_at);
    `,
  },
];

export interface DbOptions {
  dbPath: string;
}

export function openDatabase(options: DbOptions): DbHandle {
  if (options.dbPath !== ':memory:') {
    mkdirSync(dirname(options.dbPath), { recursive: true });
  }

  const Database = resolveDatabaseConstructor();
  const db = new Database(options.dbPath);

  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  return db;
}

function runMigrations(db: DbHandle): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const select = db.prepare('SELECT id FROM schema_migrations');
  const applied = new Set((select.all() as { id: string }[]).map((row) => row.id));
  const insert = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    if (m.id === '011_approval_tool_call_id' && hasColumn(db, 'approvals', 'tool_call_id')) {
      insert.run(m.id, Date.now());
      continue;
    }
    db.exec('BEGIN');
    try {
      db.exec(m.up);
      insert.run(m.id, Date.now());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function nowMs(): number {
  return Date.now();
}

function hasColumn(db: DbHandle, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name?: unknown }[];
  return rows.some((row) => row.name === column);
}
