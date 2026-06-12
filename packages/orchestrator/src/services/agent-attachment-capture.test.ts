import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
      // Mirror the real repo: remove from `saved` so sumBytes /
      // listExpired reflect the deletion immediately.
      const idx = saved.findIndex((r) => r.id === id);
      if (idx >= 0) saved.splice(idx, 1);
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

  it('decideCapture: declared application/pdf without sniff match → captures as document (bot Round 1 medium)', () => {
    // Pre-fix the generic detector only forwarded {data, mimeType}
    // blobs when mimeType started with image/, so PDFs were silently
    // dropped. The widened generic + categoryFromMime fallback now
    // captures them as the right category.
    const decision = decideCapture(
      { bytes: Buffer.from('not a real pdf body'), declaredMime: 'application/pdf' },
      undefined,
    );
    expect(decision?.category).toBe('document');
    expect(decision?.mimeType).toBe('application/pdf');
  });

  it('decideCapture: declared audio/mpeg without sniff match → captures as audio', () => {
    const decision = decideCapture(
      { bytes: Buffer.from('not a real mp3 body'), declaredMime: 'audio/mpeg' },
      undefined,
    );
    expect(decision?.category).toBe('audio');
  });

  it('decideCapture: text/plain declared mime → still skipped (not binary)', () => {
    const decision = decideCapture(
      { bytes: Buffer.from('hello'), declaredMime: 'text/plain' },
      undefined,
    );
    expect(decision).toBeNull();
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
          attachmentStoreRoot: root,
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
        { repo: repo as never, agentAttachmentRoot: root, attachmentStoreRoot: root },
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
        { repo: repo as never, agentAttachmentRoot: root, attachmentStoreRoot: root },
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
          attachmentStoreRoot: root,
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

  it('quota recovery deletes the on-disk file too — does NOT leak (bot Round 3 high)', () => {
    // Pre-fix: quota recovery called deleteAgentAttachment (row only)
    // and the file leaked. The hourly sweeper could no longer find
    // it (no row → no enumeration), so it accumulated forever.
    // Now both quota recovery and the LRU sweeper route through
    // the shared deleteOneAgentAttachmentRowAndFile helper.
    const storeRoot = tempRoot();
    try {
      // Seed an expired row whose underlying file is sitting at
      // the canonical location.
      const orgDir = join(storeRoot, 'agent-generated', 'org_test', 'run_old');
      mkdirSync(orgDir, { recursive: true });
      const expiredFile = join(orgDir, 'aatt_expired.png');
      writeFileSync(expiredFile, FAKE_PNG);
      expect(existsSync(expiredFile)).toBe(true);

      const repo = fakeRepo();
      repo.saved.push({
        id: 'aatt_expired',
        organizationId: 'org_test',
        runId: 'run_old',
        memberId: 'mem_1',
        sourceToolCallId: null,
        sourceServerId: null,
        sourceToolName: null,
        category: 'image',
        mimeType: 'image/png',
        filename: 'expired.png',
        storagePath: 'agent-generated/org_test/run_old/aatt_expired.png',
        // Make this row "expired" by the 24h cutoff that quota
        // recovery applies internally.
        byteSize: FAKE_PNG.length,
        createdAt: '2026-06-01T00:00:00.000Z',
        pinnedToMessageId: null,
      });

      // Push the org over quota by making the new blob bigger than
      // the per-org quota minus the expired bytes. Use a 200-byte
      // PNG to trigger quota recovery against a tiny quota.
      const result = captureToolResultAttachments(
        {
          repo: repo as never,
          // agentAttachmentRoot is `<root>/agent-generated/`; the
          // writer joins bare `<org>/<run>/<id>.<ext>` against it,
          // and the storage_path column carries the prefix so the
          // reader's join against attachmentStoreRoot resolves
          // canonically.
          agentAttachmentRoot: join(storeRoot, 'agent-generated'),
          attachmentStoreRoot: storeRoot,
          perOrgQuotaBytes: FAKE_PNG.length, // tiny quota → recovery
        },
        {
          organizationId: 'org_test',
          runId: 'run_new',
          memberId: 'mem_1',
          serverId: 'srv',
          toolName: 'screenshot',
          toolCallId: 'call_new',
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

      // The on-disk file for the expired row is GONE (not just
      // the DB row).
      expect(existsSync(expiredFile)).toBe(false);
      // The new attachment landed because recovery freed space.
      expect(result.attachmentRefs).toHaveLength(1);
    } finally {
      rmSync(storeRoot, { recursive: true, force: true });
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
        attachmentStoreRoot: root,
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

  it('cleanup joins against the attachment store root, NOT the agent-generated subroot (bot Round 2 medium — no double-prefix)', () => {
    // Regression: previously cleanup took agentAttachmentRoot
    // (`<home>/attachments/agent-generated/`) and joined the
    // already-prefixed storage_path against it, producing
    // `<home>/attachments/agent-generated/agent-generated/...` —
    // files were never found and never deleted. The fix gives
    // cleanup the attachmentStoreRoot (`<home>/attachments/`) so
    // the storage path resolves canonically.
    const storeRoot = tempRoot();
    try {
      // Lay down a file at the canonical location
      // `<storeRoot>/agent-generated/<org>/<run>/<id>.png` so we
      // can assert it gets deleted.
      const orgDir = join(storeRoot, 'agent-generated', 'org_test', 'run_x');
      mkdirSync(orgDir, { recursive: true });
      const absPath = join(orgDir, 'aatt_x.png');
      writeFileSync(absPath, FAKE_PNG);
      expect(existsSync(absPath)).toBe(true);

      const repo = fakeRepo();
      repo.saved.push({
        id: 'aatt_x',
        organizationId: 'org_test',
        runId: 'run_x',
        memberId: 'mem_1',
        sourceToolCallId: null,
        sourceServerId: null,
        sourceToolName: null,
        category: 'image',
        mimeType: 'image/png',
        filename: 'x.png',
        // Canonical column shape — includes the agent-generated/ prefix.
        storagePath: 'agent-generated/org_test/run_x/aatt_x.png',
        byteSize: FAKE_PNG.length,
        createdAt: '2026-06-01T00:00:00.000Z',
        pinnedToMessageId: null,
      });

      cleanupExpiredAgentAttachments({
        repo: repo as never,
        attachmentStoreRoot: storeRoot,
        ttlHours: 4,
        now: () => new Date('2026-06-11T00:01:00.000Z'),
      });

      // File was actually deleted from disk.
      expect(existsSync(absPath)).toBe(false);
    } finally {
      rmSync(storeRoot, { recursive: true, force: true });
    }
  });
});
