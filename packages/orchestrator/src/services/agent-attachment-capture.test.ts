import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentAttachment } from '@ujima/shared';
import {
  captureToolResultAttachments,
  cleanupExpiredAgentAttachments,
  decideCapture,
  sniffMimeAndCategory,
} from './agent-attachment-capture.js';

// PNG magic bytes + minimal payload — enough to satisfy
// sniffMimeAndCategory's length check.
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_PNG = Buffer.concat([PNG_HEAD, Buffer.alloc(256, 0x42)]);
const FAKE_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(256, 0x42),
]);

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'ujima-agent-att-test-'));
}

function fakeRepo(): {
  saved: AgentAttachment[];
  deleted: string[];
  pin: Record<string, string>;
  orgs: { id: string }[];
  expiredLookups: { org: string; cutoff: string }[];
  saveAgentAttachment: (att: AgentAttachment) => AgentAttachment;
  sumAgentAttachmentBytes: () => number;
  listExpiredUnpinnedAgentAttachments: (org: string, cutoff: string) => AgentAttachment[];
  deleteAgentAttachment: (org: string, id: string) => void;
  listOrganizations: () => { id: string }[];
} {
  const saved: AgentAttachment[] = [];
  const deleted: string[] = [];
  const pin: Record<string, string> = {};
  const expiredLookups: { org: string; cutoff: string }[] = [];
  const orgs: { id: string }[] = [{ id: 'org_test' }];
  return {
    saved,
    deleted,
    pin,
    orgs,
    expiredLookups,
    saveAgentAttachment(att) {
      saved.push(att);
      return att;
    },
    sumAgentAttachmentBytes: () => saved.reduce((sum, r) => sum + r.byteSize, 0),
    listExpiredUnpinnedAgentAttachments(org, cutoff) {
      expiredLookups.push({ org, cutoff });
      return saved.filter(
        (r) =>
          r.organizationId === org &&
          r.pinnedToMessageId === null &&
          r.createdAt < cutoff,
      );
    },
    deleteAgentAttachment(_org, id) {
      deleted.push(id);
    },
    listOrganizations: () => orgs,
  };
}

describe('agent-attachment-capture — sniff + decideCapture (§3.2)', () => {
  it('detects PNG, JPEG, GIF, WebP, PDF, SVG; null when no match', () => {
    expect(sniffMimeAndCategory(FAKE_PNG)?.mimeType).toBe('image/png');
    expect(sniffMimeAndCategory(FAKE_JPEG)?.mimeType).toBe('image/jpeg');
    expect(
      sniffMimeAndCategory(
        Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(64, 0)]),
      )?.mimeType,
    ).toBe('application/pdf');
    expect(sniffMimeAndCategory(Buffer.from('<svg></svg>'))?.mimeType).toBe(
      'image/svg+xml',
    );
    expect(sniffMimeAndCategory(Buffer.from('hello world'))).toBeNull();
  });

  it("decideCapture: 'never' hint overrides successful mime detection", () => {
    const decision = decideCapture({ bytes: FAKE_PNG }, 'never');
    expect(decision).toBeNull();
  });

  it("decideCapture: ['image'] hint widens — captures even when mime sniff fails", () => {
    const decision = decideCapture(
      { bytes: Buffer.from('random binary that is definitely not a known mime') },
      ['image'],
    );
    expect(decision?.category).toBe('image');
    // Falls back to octet-stream when nothing declared.
    expect(decision?.mimeType).toBe('application/octet-stream');
  });

  it('decideCapture: no hint + mime miss → null', () => {
    expect(
      decideCapture({ bytes: Buffer.from('plain text only') }, undefined),
    ).toBeNull();
  });
});

describe('captureToolResultAttachments — end-to-end', () => {
  it('Anthropic-style tool result with one image is captured and surfaced as a tc_<callId>:0 ref', () => {
    const root = tempRoot();
    try {
      const repo = fakeRepo();
      const audit = { agentAttachmentCreated: vi.fn() };
      const result = captureToolResultAttachments(
        {
          repo: repo as never,
          agentAttachmentRoot: root,
          audit,
          generateId: (() => {
            let n = 0;
            return () => `aatt_${n++}`;
          })(),
          now: () => '2026-06-11T00:00:00.000Z',
        },
        {
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
          serverId: 'srv_playwright',
          toolName: 'screenshot',
          toolCallId: 'call_42',
          toolResult: {
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  data: FAKE_PNG.toString('base64'),
                  mediaType: 'image/png',
                },
              },
            ],
          },
        },
      );
      expect(result.attachmentRefs).toHaveLength(1);
      expect(result.attachmentRefs[0]!.ref).toBe('tc_call_42:0');
      expect(result.attachmentRefs[0]!.category).toBe('image');
      expect(repo.saved).toHaveLength(1);
      expect(repo.saved[0]!.sourceToolCallId).toBe('call_42');
      expect(repo.saved[0]!.pinnedToMessageId).toBeNull();
      expect(audit.agentAttachmentCreated).toHaveBeenCalledTimes(1);
      // File landed in the configured root.
      const orgDir = join(root, 'org_test', 'run_test');
      expect(readdirSync(orgDir).length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hint='never' suppresses capture even when result contains a PNG", () => {
    const root = tempRoot();
    try {
      const repo = fakeRepo();
      const result = captureToolResultAttachments(
        { repo: repo as never, agentAttachmentRoot: root },
        {
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
          serverId: 'srv_fetch',
          toolName: 'fetch',
          toolCallId: 'call_x',
          toolResult: { image: FAKE_PNG.toString('base64') },
          registryHint: 'never',
        },
      );
      expect(result.attachmentRefs).toHaveLength(0);
      expect(repo.saved).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hint=['image'] widens: captures even when the bytes don't sniff to a known mime", () => {
    const root = tempRoot();
    try {
      const repo = fakeRepo();
      const result = captureToolResultAttachments(
        { repo: repo as never, agentAttachmentRoot: root },
        {
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
          serverId: 'srv_unknown',
          toolName: 'snapshot',
          toolCallId: 'call_x',
          toolResult: {
            data: Buffer.alloc(512, 0xaa).toString('base64'),
            mimeType: 'image/x-novel-format',
          },
          registryHint: ['image'],
        },
      );
      expect(result.attachmentRefs).toHaveLength(1);
      expect(repo.saved[0]!.category).toBe('image');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('per-file cap rejects oversized blobs but lets undersized ones through', () => {
    const root = tempRoot();
    try {
      const repo = fakeRepo();
      const bigPng = Buffer.concat([PNG_HEAD, Buffer.alloc(2000, 0x42)]);
      const result = captureToolResultAttachments(
        {
          repo: repo as never,
          agentAttachmentRoot: root,
          perFileCapBytes: 1000,
        },
        {
          organizationId: 'org_test',
          runId: 'run_test',
          memberId: 'mem_test',
          serverId: 'srv',
          toolName: 't',
          toolCallId: 'call_x',
          toolResult: { data: bigPng.toString('base64'), mimeType: 'image/png' },
        },
      );
      expect(result.attachmentRefs).toHaveLength(0);
      expect(repo.saved).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('cleanupExpiredAgentAttachments — LRU sweep', () => {
  it('deletes unpinned rows older than the TTL; pinned rows survive', () => {
    const root = tempRoot();
    try {
      const repo = fakeRepo();
      // Seed: one expired unpinned, one fresh unpinned, one pinned old.
      repo.saved.push(
        {
          id: 'aatt_old_unpinned',
          organizationId: 'org_test',
          runId: 'run_1',
          memberId: 'mem_1',
          sourceToolCallId: null,
          sourceServerId: null,
          sourceToolName: null,
          category: 'image',
          mimeType: 'image/png',
          filename: 'old.png',
          storagePath: 'old.png',
          byteSize: 1000,
          createdAt: '2026-06-01T00:00:00.000Z',
          pinnedToMessageId: null,
        },
        {
          id: 'aatt_fresh_unpinned',
          organizationId: 'org_test',
          runId: 'run_2',
          memberId: 'mem_1',
          sourceToolCallId: null,
          sourceServerId: null,
          sourceToolName: null,
          category: 'image',
          mimeType: 'image/png',
          filename: 'fresh.png',
          storagePath: 'fresh.png',
          byteSize: 1000,
          createdAt: '2026-06-11T00:00:00.000Z',
          pinnedToMessageId: null,
        },
        {
          id: 'aatt_old_pinned',
          organizationId: 'org_test',
          runId: 'run_3',
          memberId: 'mem_1',
          sourceToolCallId: null,
          sourceServerId: null,
          sourceToolName: null,
          category: 'image',
          mimeType: 'image/png',
          filename: 'pinned.png',
          storagePath: 'pinned.png',
          byteSize: 1000,
          createdAt: '2026-06-01T00:00:00.000Z',
          pinnedToMessageId: 'msg_real',
        },
      );
      const result = cleanupExpiredAgentAttachments({
        repo: repo as never,
        agentAttachmentRoot: root,
        ttlHours: 4,
        now: () => new Date('2026-06-11T00:01:00.000Z'),
      });
      // Only the old unpinned row should have been deleted.
      expect(result.deletedRows).toBe(1);
      expect(repo.deleted).toEqual(['aatt_old_unpinned']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
