import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentAttachment, Attachment } from '@ujima/shared';
import { resolveAttachmentRefs } from './agent-attachment-resolver.js';

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SMALL_PNG = Buffer.concat([PNG_HEAD, Buffer.alloc(256, 0x42)]);

function tempPair(): { agentRoot: string; workspaceRoot: string } {
  return {
    agentRoot: mkdtempSync(join(tmpdir(), 'ujima-agent-att-')),
    workspaceRoot: mkdtempSync(join(tmpdir(), 'ujima-workspace-')),
  };
}

interface FakeRepo {
  agentAttachments: AgentAttachment[];
  attachments: Attachment[];
  findAgentAttachmentByToolCall: (
    org: string,
    callId: string,
    idx: number,
  ) => AgentAttachment | null;
  saveAgentAttachment: (att: AgentAttachment) => AgentAttachment;
  pinAgentAttachmentToMessage: (org: string, id: string, msgId: string) => AgentAttachment | null;
  getAgentAttachment: (org: string, id: string) => AgentAttachment | null;
  saveAttachment: (att: Attachment) => Attachment;
  deleteAttachment: (org: string, id: string) => number;
  deleteAgentAttachment: (org: string, id: string) => void;
}

function fakeRepo(seed: AgentAttachment[] = []): FakeRepo {
  const agentAttachments: AgentAttachment[] = [...seed];
  const attachments: Attachment[] = [];
  return {
    agentAttachments,
    attachments,
    findAgentAttachmentByToolCall(_org, callId, idx) {
      const rows = agentAttachments.filter((r) => r.sourceToolCallId === callId);
      return rows[idx] ?? null;
    },
    saveAgentAttachment(att) {
      agentAttachments.push(att);
      return att;
    },
    pinAgentAttachmentToMessage(_org, id, msgId) {
      const found = agentAttachments.find((r) => r.id === id);
      if (found) found.pinnedToMessageId = msgId;
      return found ?? null;
    },
    getAgentAttachment: (_org, id) =>
      agentAttachments.find((r) => r.id === id) ?? null,
    saveAttachment(att) {
      attachments.push(att);
      return att;
    },
    deleteAttachment(_org, id) {
      const idx = attachments.findIndex((a) => a.id === id);
      if (idx >= 0) {
        attachments.splice(idx, 1);
        return 1;
      }
      return 0;
    },
    deleteAgentAttachment(_org, id) {
      const idx = agentAttachments.findIndex((a) => a.id === id);
      if (idx >= 0) agentAttachments.splice(idx, 1);
    },
  };
}

describe('resolveAttachmentRefs — tool_call', () => {
  it('promotes a captured row into a message_attachments parallel row', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const captured: AgentAttachment = {
        id: 'aatt_seed',
        organizationId: 'org_test',
        runId: 'run_test',
        memberId: 'mem_test',
        sourceToolCallId: 'call_42',
        sourceServerId: 'srv_playwright',
        sourceToolName: 'screenshot',
        category: 'image',
        mimeType: 'image/png',
        filename: 'shot.png',
        storagePath: 'org_test/run_test/seed.png',
        byteSize: 1234,
        createdAt: '2026-06-11T00:00:00.000Z',
        pinnedToMessageId: null,
      };
      const repo = fakeRepo([captured]);
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'tool_call', value: 'tc_call_42:0' }],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.materializations).toHaveLength(1);
      expect(repo.attachments).toHaveLength(1);
      // The new message_attachments row points at the SAME storage
      // path as the captured agent_attachments row — bytes live
      // exactly once on disk.
      expect(repo.attachments[0]!.storagePath).toBe(captured.storagePath);
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('returns a clean error when the tool_call ref points at nothing', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const repo = fakeRepo();
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'tool_call', value: 'tc_call_missing:0' }],
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('resolves to no captured attachment');
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('saveAttachment throwing returns a structured error and fires the rollback delete', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const captured: AgentAttachment = {
        id: 'aatt_seed',
        organizationId: 'org_test',
        runId: 'run_test',
        memberId: 'mem_test',
        sourceToolCallId: 'call_42',
        sourceServerId: 'srv_x',
        sourceToolName: 'screenshot',
        category: 'image',
        mimeType: 'image/png',
        filename: 'shot.png',
        storagePath: 'agent-generated/org_test/run_test/seed.png',
        byteSize: 1234,
        createdAt: '2026-06-11T00:00:00.000Z',
        pinnedToMessageId: null,
      };
      const repo = fakeRepo([captured]);
      // Track whether deleteAttachment ran on the rollback path —
      // it MUST be called even though saveAttachment threw before
      // returning, because the resolver registers the undo before
      // attempting the write (so a partial write inside the DB
      // call still gets cleaned up idempotently).
      let deleteCalled = 0;
      const result = await resolveAttachmentRefs(
        {
          repo: {
            ...repo,
            saveAttachment: () => {
              throw new Error('synthetic DB error from saveAttachment');
            },
            deleteAttachment: () => {
              deleteCalled += 1;
              return 0;
            },
          } as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'tool_call', value: 'tc_call_42:0' }],
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('attachments insert failed');
      expect(deleteCalled).toBe(1);
      // The captured agent_attachment row is preserved — its
      // lifecycle belongs to the capture pass, not this resolver.
      expect(repo.agentAttachments).toHaveLength(1);
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('resolveAttachmentRefs — workspace_path', () => {
  it('copies the workspace file into the agent-attachments store (immutability holds even when the source is rewritten)', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const filePath = join(workspaceRoot, 'screenshots');
      mkdirSync(filePath, { recursive: true });
      const original = SMALL_PNG;
      writeFileSync(join(filePath, 'login.png'), original);

      const repo = fakeRepo();
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'workspace_path', value: 'screenshots/login.png' }],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.materializations).toHaveLength(1);
      expect(repo.agentAttachments).toHaveLength(1);
      // Storage path lives inside the agent-generated tree, NOT the
      // workspace. Workspace can be rewritten freely without changing
      // what the message shows. The `agent-generated/` prefix is
      // required so the web API resolves the file (it prepends
      // `<home>/attachments/` and serves from there).
      expect(
        repo.agentAttachments[0]!.storagePath.startsWith('agent-generated/'),
      ).toBe(true);
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects '..' segments that would escape workspace_root", async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const repo = fakeRepo();
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'workspace_path', value: '../etc/passwd' }],
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('".."');
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects absolute paths', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const repo = fakeRepo();
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'workspace_path', value: '/etc/hostname' }],
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('absolute');
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('resolveAttachmentRefs — workspace_glob', () => {
  it('matches multiple files; each gets its own attachment row', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const dir = join(workspaceRoot, 'screenshots');
      mkdirSync(dir, { recursive: true });
      for (const name of ['a.png', 'b.png', 'c.png']) {
        writeFileSync(join(dir, name), SMALL_PNG);
      }
      const repo = fakeRepo();
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'workspace_glob', value: 'screenshots/*.png' }],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.materializations).toHaveLength(3);
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects a glob that matches more than 10 files (cap reached)', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const dir = join(workspaceRoot, 'many');
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 15; i += 1) {
        writeFileSync(join(dir, `f${i}.png`), SMALL_PNG);
      }
      const repo = fakeRepo();
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'workspace_glob', value: 'many/*.png' }],
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('more than 10 files');
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("rejects '..' in glob patterns", async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const repo = fakeRepo();
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'workspace_glob', value: '../*' }],
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('".."');
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('resolveAttachmentRefs — base64', () => {
  it('decodes inline base64 + creates rows', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const repo = fakeRepo();
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [
          {
            refType: 'base64',
            value: SMALL_PNG.toString('base64'),
            filename: 'inline.png',
          },
        ],
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(repo.agentAttachments[0]!.category).toBe('image');
      expect(repo.agentAttachments[0]!.mimeType).toBe('image/png');
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('rejects base64 over the 1MB cap', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const repo = fakeRepo();
      // 2MB buffer.
      const big = Buffer.alloc(2 * 1024 * 1024, 0xab).toString('base64');
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'base64', value: big }],
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('cap');
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

describe('resolveAttachmentRefs — symlink escape', () => {
  it('rejects a symlink inside workspace_root that points outside', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    const outsideDir = mkdtempSync(join(tmpdir(), 'ujima-outside-'));
    try {
      // Drop a file outside workspace_root, then symlink it from
      // inside. Pre-fix the string-prefix check accepted this and
      // readFileSync followed the link to exfiltrate the outside
      // bytes.
      const outsideFile = join(outsideDir, 'secret.png');
      writeFileSync(outsideFile, SMALL_PNG);
      symlinkSync(outsideFile, join(workspaceRoot, 'link.png'));

      const repo = fakeRepo();
      const result = await resolveAttachmentRefs(
        {
          repo: repo as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [{ refType: 'workspace_path', value: 'link.png' }],
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('symlink');
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

});

describe('resolveAttachmentRefs — atomic commitBytes rollback', () => {
  it('saveAttachment throwing AFTER file+agent_attachments wrote rolls back both', async () => {
    const { agentRoot, workspaceRoot } = tempPair();
    try {
      const repo = fakeRepo();
      // Override saveAttachment to throw on the FIRST call; the
      // file + agent_attachments row will already have been written
      // by commitBytes when this fires. Without the inline
      // rollback in commitBytes those would leak.
      let attachmentDeleteCalls = 0;
      let agentAttachmentDeleteCalls = 0;
      const result = await resolveAttachmentRefs(
        {
          repo: {
            ...repo,
            saveAttachment: () => {
              throw new Error('synthetic DB error from saveAttachment');
            },
            deleteAttachment: () => {
              attachmentDeleteCalls += 1;
              return 0;
            },
            deleteAgentAttachment: (_org: string, id: string) => {
              agentAttachmentDeleteCalls += 1;
              const idx = repo.agentAttachments.findIndex((a) => a.id === id);
              if (idx >= 0) repo.agentAttachments.splice(idx, 1);
            },
          } as never,
          agentAttachmentRoot: agentRoot,
          workspaceRoot,
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
        },
        [
          {
            refType: 'base64',
            value: SMALL_PNG.toString('base64'),
            filename: 'doomed.png',
          },
        ],
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The agent_attachments row got written, then commitBytes'
      // internal rollback fired and deleted it. So the row
      // count is back to 0 and the delete was invoked.
      expect(repo.agentAttachments).toHaveLength(0);
      expect(agentAttachmentDeleteCalls).toBe(1);
      // deleteAttachment IS called once — the inner rollback
      // registers the undo BEFORE saveAttachment, so a partial
      // write inside the DB layer still gets cleaned up
      // idempotently. The shared commit/rollback helper
      // (createRefCommitUndoStack) gives commitBytes and
      // resolveToolCallRef the same atomicity contract.
      expect(attachmentDeleteCalls).toBe(1);
    } finally {
      rmSync(agentRoot, { recursive: true, force: true });
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

});

void existsSync;
