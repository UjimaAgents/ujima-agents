import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import {
  aggregateProcedures,
  isAgentRestrictedProcedurePath,
  isValidProcedureName,
  listProceduresByScope,
  PROCEDURE_LAW_HARD_CAP,
  proceduresDirFor,
  removeProcedure,
  renderProcedureFile,
  saveProcedure,
} from './procedures.js';

function freshWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'culture-test-'));
}

describe('isAgentRestrictedProcedurePath', () => {
  it('blocks agent writes to org and channel culture', () => {
    expect(isAgentRestrictedProcedurePath('layla', 'ai/memory-bank/org/procedures/foo.md')).toBe(true);
    expect(isAgentRestrictedProcedurePath('layla', 'ai/memory-bank/channels/eng/procedures/foo.md')).toBe(true);
  });
});

describe('isValidProcedureName', () => {
  it('accepts lowercase-kebab', () => {
    expect(isValidProcedureName('attribute-decisions')).toBe(true);
    expect(isValidProcedureName('a1')).toBe(true);
  });
});

describe('proceduresDirFor', () => {
  it('maps every scope to the right directory', () => {
    const root = '/tmp/workspace';
    expect(proceduresDirFor(root, 'org', '')).toBe(normalize('/tmp/workspace/ai/memory-bank/org/procedures'));
    expect(proceduresDirFor(root, 'channel', 'eng')).toBe(normalize('/tmp/workspace/ai/memory-bank/channels/eng/procedures'));
    expect(proceduresDirFor(root, 'agent', 'layla')).toBe(normalize('/tmp/workspace/ai/memory-bank/agents/layla/procedures'));
  });
});

describe('saveProcedure and listProceduresByScope round-trip', () => {
  it('writes a fresh org procedure with version=1', async () => {
    const root = freshWorkspace();
    const saved = await saveProcedure({
      workspaceRoot: root,
      scope: 'org',
      scopeId: '',
      name: 'attribute-decisions',
      description: 'Tag durable decisions with the deciding member.',
      body: 'When you make a decision, include "decided-by: @<your-name>".',
      actor: 'oluwaseyi',
    });
    expect(saved.version).toBe(1);
    expect(saved.createdBy).toBe('oluwaseyi');
    expect(saved.updatedBy).toBe('oluwaseyi');
    expect(saved.enforced).toBe(false);
    const list = await listProceduresByScope(root, 'org', '');
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('attribute-decisions');
  });

  it('bumps version on re-save and preserves createdAt', async () => {
    const root = freshWorkspace();
    const v1 = await saveProcedure({
      workspaceRoot: root,
      scope: 'channel',
      scopeId: 'eng',
      name: 'pages-stay-open',
      description: 'd',
      body: 'b',
      actor: 'alice',
    });
    // Sleep a tick so the timestamps differ.
    await new Promise((r) => setTimeout(r, 5));
    const v2 = await saveProcedure({
      workspaceRoot: root,
      scope: 'channel',
      scopeId: 'eng',
      name: 'pages-stay-open',
      description: 'updated description',
      body: 'updated body',
      actor: 'bob',
    });
    expect(v2.version).toBe(2);
    expect(v2.createdBy).toBe('alice'); // preserved
    expect(v2.createdAt).toBe(v1.createdAt); // preserved
    expect(v2.updatedBy).toBe('bob');
    expect(v2.description).toBe('updated description');
  });

  it('enforces the LAW cap (3 per org)', async () => {
    const root = freshWorkspace();
    for (let i = 0; i < PROCEDURE_LAW_HARD_CAP; i += 1) {
      await saveProcedure({
        workspaceRoot: root,
        scope: 'org',
        scopeId: '',
        name: `law-${i}`,
        description: 'd',
        body: 'b',
        enforced: true,
        actor: 'owner',
      });
    }
    await expect(
      saveProcedure({
        workspaceRoot: root,
        scope: 'org',
        scopeId: '',
        name: 'law-overflow',
        description: 'd',
        body: 'b',
        enforced: true,
        actor: 'owner',
      }),
    ).rejects.toThrow(/max 3 LAW entries|max 3/);
  });

  it('removeProcedure deletes the file and returns true', async () => {
    const root = freshWorkspace();
    await saveProcedure({
      workspaceRoot: root,
      scope: 'agent',
      scopeId: 'layla',
      name: 'my-rule',
      description: 'd',
      body: 'b',
      actor: 'self.layla',
    });
    const ok = await removeProcedure(root, 'agent', 'layla', 'my-rule');
    expect(ok).toBe(true);
    const list = await listProceduresByScope(root, 'agent', 'layla');
    expect(list).toHaveLength(0);
    // second call returns false (already gone).
    expect(await removeProcedure(root, 'agent', 'layla', 'my-rule')).toBe(false);
  });
});

describe('renderProcedureFile write-time normalisation', () => {
  it('strips CRLF and trailing whitespace so cache stability holds', () => {
    const rendered = renderProcedureFile({
      scope: 'agent',
      scopeId: 'layla',
      name: 'a',
      description: 'd',
      body: 'line1   \r\nline2\t  \r\nline3',
      createdAt: '2026-05-28T00:00:00Z',
      createdBy: 'x',
      updatedAt: '2026-05-28T00:00:00Z',
      updatedBy: 'x',
      version: 1,
      enforced: false,
      path: '/x.md',
    });
    expect(rendered).not.toContain('\r');
    // No trailing spaces before newlines:
    expect(rendered).not.toMatch(/[ \t]+\n/);
  });
});

describe('aggregateProcedures', () => {
  it('returns nothing when no procedures exist', async () => {
    const root = freshWorkspace();
    const out = await aggregateProcedures({
      workspaceRoot: root,
      organizationId: 'org-1',
      memberId: 'layla',
      channelId: 'eng',
    });
    expect(out.applied).toHaveLength(0);
    expect(out.cultureText).toBeUndefined();
    expect(out.lawText).toBeUndefined();
  });

  it('merges org + channel + agent and hoists LAW separately', async () => {
    const root = freshWorkspace();
    await saveProcedure({
      workspaceRoot: root,
      scope: 'org',
      scopeId: '',
      name: 'no-customer-data',
      description: 'Never share customer data in chat.',
      body: 'Customer data leaves the workspace ONLY via approved channels.',
      enforced: true,
      actor: 'owner',
    });
    await saveProcedure({
      workspaceRoot: root,
      scope: 'org',
      scopeId: '',
      name: 'attribute-decisions',
      description: 'Tag durable decisions with the deciding member.',
      body: 'Include decided-by: @<name>',
      actor: 'owner',
    });
    await saveProcedure({
      workspaceRoot: root,
      scope: 'channel',
      scopeId: 'incident-response',
      name: 'pages-stay-open',
      description: 'Pages stay open until RCA is posted.',
      body: 'Do not close.',
      actor: 'sre',
    });
    await saveProcedure({
      workspaceRoot: root,
      scope: 'agent',
      scopeId: 'layla',
      name: 'ping-phoebe-with-paths',
      description: 'Include the artifact path explicitly.',
      body: 'When pinging Phoebe…',
      actor: 'self.layla',
    });
    const out = await aggregateProcedures({
      workspaceRoot: root,
      organizationId: 'org-1',
      memberId: 'layla',
      channelId: 'incident-response',
    });
    expect(out.applied).toHaveLength(4);
    expect(out.cultureText).toContain('Workspace Culture');
    expect(out.cultureText).toContain('Channel Culture');
    expect(out.cultureText).toContain('Your own procedures');
    expect(out.lawText).toMatch(/^LAW \(do not violate\):/);
    expect(out.lawText).toContain('Customer data leaves the workspace');
  });

});

describe('aggregator cache stability', () => {
  it('two aggregator calls on the same inputs produce identical text', async () => {
    const root = freshWorkspace();
    await saveProcedure({
      workspaceRoot: root,
      scope: 'org',
      scopeId: '',
      name: 'z-last',
      description: 'second alphabetically',
      body: 'b',
      actor: 'owner',
    });
    await saveProcedure({
      workspaceRoot: root,
      scope: 'org',
      scopeId: '',
      name: 'a-first',
      description: 'first alphabetically',
      body: 'b',
      actor: 'owner',
    });
    const first = await aggregateProcedures({
      workspaceRoot: root,
      organizationId: 'org-1',
      memberId: 'layla',
    });
    const second = await aggregateProcedures({
      workspaceRoot: root,
      organizationId: 'org-1',
      memberId: 'layla',
    });
    expect(second.cultureText).toBe(first.cultureText);
    // Sort by name (not createdAt): 'a-first' must precede 'z-last'.
    const lines = first.cultureText?.split('\n') ?? [];
    const aIdx = lines.findIndex((l) => l.includes('a-first'));
    const zIdx = lines.findIndex((l) => l.includes('z-last'));
    expect(aIdx).toBeGreaterThan(-1);
    expect(zIdx).toBeGreaterThan(aIdx);
  });
});

