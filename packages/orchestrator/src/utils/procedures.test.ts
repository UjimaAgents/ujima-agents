import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, normalize } from 'node:path';
import {
  aggregateProcedures,
  isAgentRestrictedProcedurePath,
  isProceduresPath,
  isValidProcedureName,
  listProceduresByScope,
  PROCEDURE_BUDGETS,
  PROCEDURE_LAW_HARD_CAP,
  proceduresDirFor,
  removeProcedure,
  renderProcedureFile,
  saveProcedure,
} from './procedures.js';

function freshWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'culture-test-'));
}

describe('isProceduresPath', () => {
  it('matches every scope', () => {
    expect(isProceduresPath('ai/memory-bank/org/procedures/foo.md')).toBe(true);
    expect(isProceduresPath('ai/memory-bank/channels/eng/procedures/bar.md')).toBe(true);
    expect(isProceduresPath('ai/memory-bank/agents/layla/procedures/baz.md')).toBe(true);
  });
  it('rejects sibling paths', () => {
    expect(isProceduresPath('ai/memory-bank/tasks/foo.md')).toBe(false);
    expect(isProceduresPath('ai/memory-bank/org/policies/foo.md')).toBe(false);
    expect(isProceduresPath('src/components/procedures/foo.tsx')).toBe(false);
  });
});

describe('isAgentRestrictedProcedurePath', () => {
  it('blocks agent writes to org and channel culture', () => {
    expect(isAgentRestrictedProcedurePath('layla', 'ai/memory-bank/org/procedures/foo.md')).toBe(true);
    expect(isAgentRestrictedProcedurePath('layla', 'ai/memory-bank/channels/eng/procedures/foo.md')).toBe(true);
  });
  it('blocks agent writes to OTHER agents subtree', () => {
    expect(isAgentRestrictedProcedurePath('layla', 'ai/memory-bank/agents/phoebe/procedures/foo.md')).toBe(true);
    expect(isAgentRestrictedProcedurePath('layla', 'ai/memory-bank/agents/phoebe/notes.md')).toBe(true);
  });
  it('allows agent writes to own subtree', () => {
    expect(isAgentRestrictedProcedurePath('layla', 'ai/memory-bank/agents/layla/procedures/foo.md')).toBe(false);
    expect(isAgentRestrictedProcedurePath('layla', 'ai/memory-bank/agents/layla/notes.md')).toBe(false);
  });
  it('allows writes outside the memory-bank entirely', () => {
    expect(isAgentRestrictedProcedurePath('layla', 'ai/memory-bank/tasks/foo.md')).toBe(false);
    expect(isAgentRestrictedProcedurePath('layla', 'src/foo.ts')).toBe(false);
  });
});

describe('isValidProcedureName', () => {
  it('accepts lowercase-kebab', () => {
    expect(isValidProcedureName('attribute-decisions')).toBe(true);
    expect(isValidProcedureName('a1')).toBe(true);
  });
  it('rejects bad shapes', () => {
    expect(isValidProcedureName('UPPER')).toBe(false);
    expect(isValidProcedureName('with space')).toBe(false);
    expect(isValidProcedureName('-leading-hyphen')).toBe(false);
    expect(isValidProcedureName('x')).toBe(false); // < 2 chars
  });
});

describe('proceduresDirFor', () => {
  it('maps every scope to the right directory', () => {
    const root = '/tmp/workspace';
    expect(proceduresDirFor(root, 'org', '')).toBe(normalize('/tmp/workspace/ai/memory-bank/org/procedures'));
    expect(proceduresDirFor(root, 'channel', 'eng')).toBe(normalize('/tmp/workspace/ai/memory-bank/channels/eng/procedures'));
    expect(proceduresDirFor(root, 'agent', 'layla')).toBe(normalize('/tmp/workspace/ai/memory-bank/agents/layla/procedures'));
  });
  it('sanitises unsafe segments', () => {
    const root = '/tmp/workspace';
    expect(proceduresDirFor(root, 'channel', '../etc/passwd')).toContain('etc-passwd');
    expect(proceduresDirFor(root, 'agent', '../escape')).toContain('escape');
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

  it('rejects enforced=true on non-org scopes', async () => {
    const root = freshWorkspace();
    await expect(
      saveProcedure({
        workspaceRoot: root,
        scope: 'channel',
        scopeId: 'eng',
        name: 'channel-rule',
        description: 'd',
        body: 'b',
        enforced: true,
        actor: 'alice',
      }),
    ).rejects.toThrow(/enforced=true is only valid/);
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

  it('respects the per-scope byte budget', async () => {
    const root = freshWorkspace();
    // Stuff org with enough entries to overflow 750 bytes worth of
    // "- name: description\n" lines. Each is ~80 bytes; ~10 lines fits,
    // anything beyond should be dropped.
    for (let i = 0; i < 30; i += 1) {
      await saveProcedure({
        workspaceRoot: root,
        scope: 'org',
        scopeId: '',
        name: `procedure-${String(i).padStart(2, '0')}`,
        description: 'Long-ish description to consume budget bytes deterministically.',
        body: 'b',
        actor: 'owner',
      });
    }
    const out = await aggregateProcedures({
      workspaceRoot: root,
      organizationId: 'org-1',
      memberId: 'layla',
    });
    expect(out.applied.length).toBeLessThanOrEqual(30);
    // Org budget is 750 bytes; fitted entries should not exceed it.
    const orgBytes = out.cultureText
      ? Buffer.byteLength(
          out.cultureText
            .split('\n')
            .filter((line) => line.startsWith('- procedure-'))
            .join('\n'),
          'utf8',
        )
      : 0;
    expect(orgBytes).toBeLessThanOrEqual(PROCEDURE_BUDGETS.org);
  });

  it('skips channel section when channelId is absent', async () => {
    const root = freshWorkspace();
    await saveProcedure({
      workspaceRoot: root,
      scope: 'channel',
      scopeId: 'eng',
      name: 'eng-rule',
      description: 'd',
      body: 'b',
      actor: 'admin',
    });
    // Add an unrelated org procedure so cultureText is defined and we
    // can assert the channel section is NOT in it.
    await saveProcedure({
      workspaceRoot: root,
      scope: 'org',
      scopeId: '',
      name: 'org-rule',
      description: 'd',
      body: 'b',
      actor: 'owner',
    });
    const out = await aggregateProcedures({
      workspaceRoot: root,
      organizationId: 'org-1',
      memberId: 'layla',
      // no channelId
    });
    expect(out.cultureText).toBeDefined();
    expect(out.cultureText ?? '').not.toContain('Channel Culture');
    expect(out.cultureText ?? '').toContain('Workspace Culture');
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

describe('directory survives bad YAML', () => {
  it('skips unreadable files instead of throwing', async () => {
    const root = freshWorkspace();
    const dir = proceduresDirFor(root, 'org', '');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.md'), 'no frontmatter just text', 'utf8');
    writeFileSync(join(dir, 'good.md'), `---\nname: good\ndescription: d\ncreated_at: 2026\ncreated_by: x\nupdated_at: 2026\nupdated_by: x\nversion: 1\n---\nbody`, 'utf8');
    const list = await listProceduresByScope(root, 'org', '');
    // Both load — the "broken" one falls back to name=filename.
    expect(list.map((p) => p.name).sort()).toEqual(['broken', 'good']);
  });
});
