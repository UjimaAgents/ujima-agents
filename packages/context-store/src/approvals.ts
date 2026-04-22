import { nowMs, type DbHandle } from './db';

export type ApprovalStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected';

export interface ApprovalRecord {
  id: string;
  task_id: string;
  artifact_key: string;
  domain: string;
  status: ApprovalStatus;
  proposed_by?: string;
  approved_by?: string;
  decided_at?: number;
  reason?: string;
  created_at: number;
}

export interface ApprovalTracker {
  propose(input: {
    id: string;
    task_id: string;
    artifact_key: string;
    domain: string;
    proposed_by: string;
  }): Promise<void>;
  decide(
    id: string,
    decision: { status: 'approved' | 'rejected'; approved_by: string; reason?: string },
  ): Promise<void>;
  get(id: string): Promise<ApprovalRecord | undefined>;
  listByTask(task_id: string, status?: ApprovalStatus): Promise<ApprovalRecord[]>;
  listApprovedByDomain(task_id: string, domain: string): Promise<ApprovalRecord[]>;
}

export function createApprovalTracker(db: DbHandle): ApprovalTracker {
  const insert = db.prepare(
    `INSERT INTO task_approvals (id, task_id, artifact_key, domain, status, proposed_by, created_at)
     VALUES (?, ?, ?, ?, 'pending_approval', ?, ?)`,
  );
  const decide = db.prepare(
    'UPDATE task_approvals SET status = ?, approved_by = ?, reason = ?, decided_at = ? WHERE id = ?',
  );
  const selectOne = db.prepare('SELECT * FROM task_approvals WHERE id = ?');
  const selectByTask = db.prepare(
    'SELECT * FROM task_approvals WHERE task_id = ? ORDER BY created_at ASC',
  );
  const selectByTaskStatus = db.prepare(
    'SELECT * FROM task_approvals WHERE task_id = ? AND status = ? ORDER BY created_at ASC',
  );
  const selectApprovedByDomain = db.prepare(
    "SELECT * FROM task_approvals WHERE task_id = ? AND domain = ? AND status = 'approved' ORDER BY decided_at ASC",
  );

  const parse = (r: RawApprovalRow): ApprovalRecord => ({
    id: r.id,
    task_id: r.task_id,
    artifact_key: r.artifact_key,
    domain: r.domain,
    status: r.status as ApprovalStatus,
    proposed_by: r.proposed_by ?? undefined,
    approved_by: r.approved_by ?? undefined,
    decided_at: r.decided_at ?? undefined,
    reason: r.reason ?? undefined,
    created_at: r.created_at,
  });

  return {
    async propose(input) {
      insert.run(input.id, input.task_id, input.artifact_key, input.domain, input.proposed_by, nowMs());
    },
    async decide(id, decision) {
      decide.run(decision.status, decision.approved_by, decision.reason ?? null, nowMs(), id);
    },
    async get(id) {
      const row = selectOne.get(id) as RawApprovalRow | undefined;
      return row ? parse(row) : undefined;
    },
    async listByTask(task_id, status) {
      const rows = status
        ? (selectByTaskStatus.all(task_id, status) as RawApprovalRow[])
        : (selectByTask.all(task_id) as RawApprovalRow[]);
      return rows.map(parse);
    },
    async listApprovedByDomain(task_id, domain) {
      const rows = selectApprovedByDomain.all(task_id, domain) as RawApprovalRow[];
      return rows.map(parse);
    },
  };
}

interface RawApprovalRow {
  id: string;
  task_id: string;
  artifact_key: string;
  domain: string;
  status: string;
  proposed_by: string | null;
  approved_by: string | null;
  decided_at: number | null;
  reason: string | null;
  created_at: number;
}
