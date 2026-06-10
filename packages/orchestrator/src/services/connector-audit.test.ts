import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '@ujima/shared';
import { createConnectorAuditWriter, redactArgs } from './connector-audit.js';

// Three load-bearing invariants for the §12 emitter — the audit row
// queries (tool_name index hits, server_id grep), the approval-card
// data flow, and the curation job's PR 9 analysis all rest on these.
// Further variations (every metadata key shape, every redaction
// edge case) belong in the QA suite.

function makeWriter() {
  const events: AuditEvent[] = [];
  const writer = createConnectorAuditWriter({
    repo: { saveAuditEvent: (e) => (events.push(e), e) },
    generateId: () => 'aud_test',
    now: () => '2026-06-08T00:00:00.000Z',
  });
  return { writer, events };
}

describe('createConnectorAuditWriter', () => {
  it('writes the unwrapped tuple to the indexed columns, not just metadata', () => {
    const { writer, events } = makeWriter();
    writer.invocationRequested({
      organizationId: 'org_1',
      actorMemberId: 'mem_agent',
      runId: 'run_1',
      serverId: 'slack',
      toolName: 'post_message',
      args: { channel: '#team', text: 'hi' },
    });
    expect(events).toHaveLength(1);
    const row = events[0]!;
    // The whole point of PR 7 + PR 8 — operator queries hit these
    // columns directly, never the metadata blob. If a future refactor
    // moves the tuple into metadata-only the queries silently fail.
    expect(row.serverId).toBe('slack');
    expect(row.toolName).toBe('post_message');
    expect(row.argsJson).toBe(JSON.stringify({ channel: '#team', text: 'hi' }));
    expect(row.action).toBe('connector_invocation_requested');
  });

  it('redacts known secret keys from args_json before persistence', () => {
    // The un-redacted args still live in the per-task task_audit_events
    // table for debug; the org-wide row is what an operator pulls from
    // the index. Leaking a secret here would persist across queries.
    const { writer, events } = makeWriter();
    writer.invocationRequested({
      organizationId: 'org_1',
      actorMemberId: 'mem_agent',
      runId: 'run_1',
      serverId: 'sentry',
      toolName: 'create_release',
      args: {
        password: 'hunter2',
        nested: { api_key: 'sk_live_42', other: 'ok' },
        ok: 'visible',
      },
    });
    const parsed = JSON.parse(events[0]!.argsJson!) as Record<string, unknown>;
    expect(parsed.password).toBe('***');
    expect((parsed.nested as Record<string, unknown>).api_key).toBe('***');
    expect((parsed.nested as Record<string, unknown>).other).toBe('ok');
    expect(parsed.ok).toBe('visible');
  });

  it('marks rejected resolutions as blocked status', () => {
    // The §5.3 timeline reads `status` to render the arrow row.
    // approved→ok / rejected→blocked keeps the rendering branch clean
    // without re-deriving from the resolution string.
    const { writer, events } = makeWriter();
    writer.invocationResolved({
      organizationId: 'org_1',
      approvalId: 'app_1',
      serverId: 'slack',
      toolName: 'post_message',
      resolution: 'reject',
    });
    writer.invocationResolved({
      organizationId: 'org_1',
      approvalId: 'app_2',
      serverId: 'slack',
      toolName: 'post_message',
      resolution: 'allow_once',
    });
    expect(events[0]!.status).toBe('blocked');
    expect(events[1]!.status).toBe('ok');
  });

  it('swallows + logs saveAuditEvent failures so connector hot paths stay alive', () => {
    // §12 telemetry is best-effort by construction. A transient DB
    // failure (lock contention, schema drift, disk-full bun:sqlite
    // hiccup) must NOT propagate out of the writer and abort the
    // connector call, the tier-toggle PATCH, the approval-resolution
    // path, or the replay-completion path. Centralising the swallow
    // in createConnectorAuditWriter is what makes every caller
    // best-effort without per-site try/catch.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const writer = createConnectorAuditWriter({
      repo: {
        saveAuditEvent: () => {
          throw new Error('simulated DB lock');
        },
      },
      generateId: () => 'aud_test',
      now: () => '2026-06-09T00:00:00.000Z',
    });

    // Each method must return normally, never throw.
    expect(() =>
      writer.invocationRequested({
        organizationId: 'org_1',
        actorMemberId: 'mem_agent',
        runId: 'run_1',
        serverId: 'slack',
        toolName: 'post_message',
        args: { channel: '#team' },
      }),
    ).not.toThrow();
    expect(() =>
      writer.invocationCompleted({
        organizationId: 'org_1',
        actorMemberId: 'mem_agent',
        runId: 'run_1',
        serverId: 'slack',
        toolName: 'post_message',
        success: true,
      }),
    ).not.toThrow();
    expect(() =>
      writer.tierChanged({
        organizationId: 'org_1',
        memberId: 'mem_agent',
        serverId: 'slack',
        fromTier: 'native',
        toTier: 'dispatch',
      }),
    ).not.toThrow();

    // The failures are logged so operators can see telemetry drops.
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy.mock.calls[0]![0]).toMatch(/saveAuditEvent failed/);
    warnSpy.mockRestore();
  });
});

describe('redactArgs', () => {
  it('handles snake_case / camelCase / mixed without missing any', () => {
    const out = redactArgs({
      api_key: 'a',
      apiKey: 'b',
      Authorization: 'c',
      AUTH: 'd',
    }) as Record<string, string>;
    expect(out.api_key).toBe('***');
    expect(out.apiKey).toBe('***');
    expect(out.Authorization).toBe('***');
    expect(out.AUTH).toBe('***');
  });

  it('walks arrays and nested objects', () => {
    const out = redactArgs({
      payloads: [{ token: 't1' }, { token: 't2', body: { secret: 's' } }],
    }) as { payloads: { token: string; body?: { secret: string } }[] };
    expect(out.payloads[0]!.token).toBe('***');
    expect(out.payloads[1]!.token).toBe('***');
    expect(out.payloads[1]!.body!.secret).toBe('***');
  });

  it('returns primitives unchanged', () => {
    expect(redactArgs('hello')).toBe('hello');
    expect(redactArgs(42)).toBe(42);
    expect(redactArgs(null)).toBe(null);
  });
});
