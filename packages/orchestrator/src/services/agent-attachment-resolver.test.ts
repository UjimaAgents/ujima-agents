import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
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
