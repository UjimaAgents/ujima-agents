import { describe, expect, it, vi } from 'vitest';
import { CommitmentService, extractCommitment, extractCompletion } from './commitment-service.js';
import {
  AGENT_KIND,
  MessageSchema,
  RunStateSchema,
  TodoSchema,
  type Channel,
  type Member,
  type Message,
  type RunState,
  type Todo,
} from '@ujima/shared';
import type { ApiRepository } from './repository-reader.js';
import type { ConversationService } from './conversation.js';
import type { RealtimeService } from './context.js';

// Commitment / completion extractor regression coverage (Bet 4 +
// post-review follow-up). These regexes ship with no LLM call and
// will eventually be tuned against real channel traffic; the tests
// are the only guard against silent calibration drift.

describe('extractCommitment — positive', () => {
  it.each([
    "I'll draft the BRD",
    "I will draft the Business Requirements Document",
    "I am going to write the migration",
    "I'm going to set up the staging environment",
    'Starting now on the schema audit',
    'Beginning work on the dashboard refactor',
    'Drafting the BRD now',
    'Building the deploy pipeline',
  ])('extracts a commitment from %s', (body) => {
    const result = extractCommitment(body);
    expect(result).not.toBeNull();
    expect(result?.deliverableSummary.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});

describe('extractCommitment — negative (vacuous / non-commitments)', () => {
  it.each([
    "I'll await your reply",
    "I will wait for the file",
    "I'll be brief",
    "I'll be quick",
    "I'll note that the deploy succeeded",
    'I will say this is unusual',
    "I'll second that recommendation",
    "I will agree with the decision",
    "I'll let you know once it's ready",
    "I'll think about it",
  ])('does NOT extract from %s', (body) => {
    expect(extractCommitment(body)).toBeNull();
  });

  it('does NOT extract when the deliverable lacks a noun-ish token', () => {
    // "I'll be brief" matches the verb pattern but "brief" alone is
    // in NON_NOUN_TOKENS. The noun-ish guard kicks in.
    expect(extractCommitment("I'll do something quick.")).toBeNull();
  });

  it('does NOT extract from a body wholly inside a code fence', () => {
    expect(extractCommitment("```\nI'll draft the BRD\n```")).toBeNull();
  });

  it('does NOT extract from a fully-quoted block', () => {
    expect(extractCommitment("> I'll draft the BRD\n> Let me know")).toBeNull();
  });

  it('returns null on empty / oversize body', () => {
    expect(extractCommitment('')).toBeNull();
    expect(extractCommitment('a'.repeat(2050))).toBeNull();
  });
});

describe('extractCompletion — captures past-tense delivered work', () => {
  // The dogfood scenario that surfaced this: Layla announced
  // completed work ("I have drafted the BRD and saved it to
  // `ai/memory-bank/site-setup.md`") but the future-tense extractor
  // didn't fire, so the goals rail stayed empty. Completion
  // patterns close that gap.
  it.each([
    [
      'I have drafted the BRD based on your test results and saved it to `ai/memory-bank/site-setup.md`. It is now available for your review.',
      'ai/memory-bank/site-setup.md',
    ],
    [
      "I've created the development task list. You can find it at ai/memory-bank/tasks/google-search-verification-tasklist.md.",
      'ai/memory-bank/tasks/google-search-verification-tasklist.md',
    ],
    [
      'Saved to docs/specs/v1.md',
      'docs/specs/v1.md',
    ],
    [
      'I just finished writing the schema doc to schema.md',
      'schema.md',
    ],
  ])('extracts %s → %s', (body, expectedPath) => {
    const result = extractCompletion(body);
    expect(result).not.toBeNull();
    expect(result?.artifactPath).toBe(expectedPath);
    expect(result?.deliverableSummary).toBe(expectedPath);
  });

  it('rejects external URLs', () => {
    expect(extractCompletion('I have published it to https://example.com/spec')).toBeNull();
  });

  it('rejects absolute filesystem paths outside the workspace', () => {
    expect(extractCompletion('I have written to /etc/passwd')).toBeNull();
  });

  it('accepts /tmp/* absolute paths (sandboxed staging area)', () => {
    const result = extractCompletion('Saved to /tmp/staging-output.md');
    expect(result?.artifactPath).toBe('/tmp/staging-output.md');
  });

  it('returns null on a body with no path-shaped token', () => {
    expect(extractCompletion('I have drafted the BRD and will share it soon.')).toBeNull();
  });

  // Dogfood regression: the old code required "to / at / in / on"
  // as the connector before the path, so "review it here: <path>"
  // and "See <path>" missed the extractor entirely. The path-signal
  // refactor decoupled the verb from the connector — any workspace-
  // shaped path token in a body that also contains a completion verb
  // is now treated as an artifact reference.
  it.each([
    [
      "I have created a summary document of Phoebe Parker's findings for the 'Settings' section. You can review it here: `ai/memory-bank/tasks/my-payroll-settings-documentation-summary.md`",
      'ai/memory-bank/tasks/my-payroll-settings-documentation-summary.md',
    ],
    [
      'I have written the spec. See docs/spec.md',
      'docs/spec.md',
    ],
    [
      'I have compiled the report — `ai/memory-bank/report.md`',
      'ai/memory-bank/report.md',
    ],
    [
      "I've delivered the PRD. Available here: docs/prd.md",
      'docs/prd.md',
    ],
  ])('extracts from connector-agnostic delivery shape %s', (body, expected) => {
    const result = extractCompletion(body);
    expect(result?.artifactPath).toBe(expected);
  });

  it('does NOT match a sentence-ending word with a fake extension (Phoebe.Parker)', () => {
    // The path-token pattern requires either a slash OR a known file
    // extension. "Parker" isn't in the extension allowlist, so this
    // shouldn't be mistaken for a deliverable.
    expect(extractCompletion('I have spoken with Phoebe.Parker about the issue.')).toBeNull();
  });
});

// -----------------------------------------------------------------------
// CommitmentService — runtime behaviour (dedup + run-completed hook)
// -----------------------------------------------------------------------
//
// The post-mortem on the Layla/Phoebe stall in channel-9ufz1jk3
// (2026-05-22) surfaced three compounding gaps:
//   1. No commitment dedup — three identical "I will proceed…"
//      messages produced three separate todos and three independent
//      self-followup wake cycles.
//   2. No empty-wake counter — five consecutive self-followup wakes
//      completed with no publishing terminator and the conversation
//      silently cycled for the full 24h deadline window.
//   3. No early escalation — the deadline-letter was the only safety
//      net, 24h out, so nobody saw the stall in real time.
//
// These tests exercise the runtime fixes that close each gap.

interface MockRepoState {
  todos: Map<string, Todo>;
  channels: Map<string, Channel>;
  members: Map<string, Member>;
  messages: Map<string, Message>;
  taskSessions: Map<string, unknown>;
}

function buildMockRepo(state: MockRepoState): ApiRepository {
  const repo: Partial<ApiRepository> = {
    getMember: (_orgId, memberId) => state.members.get(memberId) ?? null,
    getChannel: (_orgId, channelId) => state.channels.get(channelId) ?? null,
    getMessage: (_orgId, messageId) => state.messages.get(messageId) ?? null,
    saveTodo: (todo) => {
      const parsed = TodoSchema.parse(todo);
      state.todos.set(parsed.id, parsed);
      return parsed;
    },
    findOpenChannelCommitmentForMember: (_orgId, channelId, memberId, sinceIso) => {
      const candidates = Array.from(state.todos.values()).filter(
        (t) =>
          t.channelId === channelId &&
          t.memberId === memberId &&
          (t.status === 'pending' || t.status === 'in_progress') &&
          t.deliverableSummary !== undefined &&
          t.createdAt >= sinceIso,
      );
      candidates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return candidates[0] ?? null;
    },
    findCommitmentBySourceMessage: (_orgId, sourceMessageId) => {
      const matches = Array.from(state.todos.values()).filter(
        (t) => t.sourceMessageId === sourceMessageId,
      );
      matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return matches[0] ?? null;
    },
    findOpenTaskSessionForChannel: () => null,
    saveTaskSession: (session) => session,
  };
  return repo as ApiRepository;
}

function buildMockRealtime(): RealtimeService {
  return { emit: vi.fn() } as unknown as RealtimeService;
}

function buildMockConversations(): ConversationService {
  return {
    publishMessage: vi.fn(),
  } as unknown as ConversationService;
}

function makeMessage(overrides: Partial<Message> & { id: string; content: string }): Message {
  return MessageSchema.parse({
    id: overrides.id,
    organizationId: overrides.organizationId ?? 'org-1',
    threadId: overrides.threadId ?? 'channel-1',
    channelId: overrides.channelId ?? 'channel-1',
    senderId: overrides.senderId ?? 'layla',
    senderKind: overrides.senderKind ?? AGENT_KIND,
    kind: overrides.kind ?? AGENT_KIND,
    content: overrides.content,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  });
}

function makeChannel(): Channel {
  return {
    id: 'channel-1',
    organizationId: 'org-1',
    name: 'general',
    kind: 'general',
    topic: '',
    memberIds: ['layla', 'phoebe'],
    createdAt: new Date().toISOString(),
  } as Channel;
}

function makeMember(id: string): Member {
  return {
    id,
    organizationId: 'org-1',
    name: id,
    kind: AGENT_KIND,
    roleName: 'engineer',
    presence: 'online',
    createdAt: new Date().toISOString(),
  } as Member;
}

function makeRun(overrides: Partial<RunState> & { id: string; sourceMessageId: string }): RunState {
  return RunStateSchema.parse({
    id: overrides.id,
    organizationId: overrides.organizationId ?? 'org-1',
    agentId: overrides.agentId ?? 'layla',
    threadId: overrides.threadId ?? 'channel-1',
    status: overrides.status ?? 'completed',
    step: overrides.step ?? 'completed',
    summary: overrides.summary ?? '',
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    endedAt: overrides.endedAt ?? new Date().toISOString(),
    terminatingTool: overrides.terminatingTool ?? null,
    wakeReason: overrides.wakeReason ?? 'self-followup',
    sourceMessageId: overrides.sourceMessageId,
    byMemberId: overrides.byMemberId ?? 'layla',
  });
}

describe('CommitmentService.onAgentMessagePublished — dedup', () => {
  function setup() {
    const state: MockRepoState = {
      todos: new Map(),
      channels: new Map([['channel-1', makeChannel()]]),
      members: new Map([
        ['layla', makeMember('layla')],
        ['phoebe', makeMember('phoebe')],
      ]),
      messages: new Map(),
      taskSessions: new Map(),
    };
    const repo = buildMockRepo(state);
    const conversations = buildMockConversations();
    const realtime = buildMockRealtime();
    const wakeOwner = vi.fn();
    const service = new CommitmentService(repo, conversations, realtime, wakeOwner, {
      dedupWindowMs: 5 * 60 * 1000,
    });
    return { service, state };
  }

  it('inserts a new todo on the first commitment for a (channel, member) pair', async () => {
    const { service, state } = setup();
    const msg = makeMessage({ id: 'm-1', content: "I will draft the BRD now." });
    await service.onAgentMessagePublished(msg);
    expect(state.todos.size).toBe(1);
    const todo = Array.from(state.todos.values())[0]!;
    expect(todo.memberId).toBe('layla');
    expect(todo.channelId).toBe('channel-1');
    expect(todo.status).toBe('in_progress');
    expect(todo.sourceMessageId).toBe('m-1');
    expect(todo.emptyWakeCount).toBe(0);
  });

  it('dedups a near-identical second commitment in the same window (updates existing instead of inserting)', async () => {
    // This is the Layla/Phoebe scenario condensed: same agent says
    // "I will proceed…" twice in seconds. Without dedup we would
    // get two todos and two independent wake cycles.
    const { service, state } = setup();
    await service.onAgentMessagePublished(
      makeMessage({ id: 'm-1', content: 'I will now proceed to compile the task list.' }),
    );
    await service.onAgentMessagePublished(
      makeMessage({ id: 'm-2', content: 'I will proceed with creating the task list now.' }),
    );
    expect(state.todos.size).toBe(1);
    const todo = Array.from(state.todos.values())[0]!;
    // Source message rolled forward to the newest restatement so
    // re-wakes target the most recent context.
    expect(todo.sourceMessageId).toBe('m-2');
  });

  it('does NOT dedup commitments from different members in the same channel', async () => {
    const { service, state } = setup();
    await service.onAgentMessagePublished(
      makeMessage({ id: 'm-1', senderId: 'layla', content: 'I will draft the BRD now.' }),
    );
    await service.onAgentMessagePublished(
      makeMessage({ id: 'm-2', senderId: 'phoebe', content: 'I will write the test plan now.' }),
    );
    expect(state.todos.size).toBe(2);
  });

  it('does NOT dedup against a past-tense completion (delivered work is its own row)', async () => {
    const { service, state } = setup();
    await service.onAgentMessagePublished(
      makeMessage({ id: 'm-1', content: 'I will draft the BRD now.' }),
    );
    await service.onAgentMessagePublished(
      makeMessage({
        id: 'm-2',
        content: 'I have drafted the BRD and saved it to ai/memory-bank/brd.md.',
      }),
    );
    // Path-bearing completion: original commitment closed (status:
    // completed), plus a new completed row anchored on the artifact
    // path. The rail surfaces the delivered artifact instead of the
    // half-written promise.
    expect(state.todos.size).toBe(2);
    const completed = Array.from(state.todos.values()).filter((t) => t.status === 'completed');
    expect(completed.length).toBe(2);
    const byPath = completed.find((t) => t.deliverableSummary === 'ai/memory-bank/brd.md');
    expect(byPath).toBeDefined();
  });
});

describe('CommitmentService.onAgentMessagePublished — in-channel delivery resolution', () => {
  // The dogfood scenario behind this branch: Layla committed to
  // "compile the task list", then 30 minutes later posted the task
  // list INLINE (no file path). The future-tense extractor doesn't
  // fire (past-tense), the path-bearing completion extractor doesn't
  // fire (no path), so the old code created nothing — and the
  // original in-progress todo lingered indefinitely. The in-channel
  // delivery branch closes the matching open commitment instead.

  function setupWithOpenCommitment(opts: { deliverable?: string } = {}) {
    const state: MockRepoState = {
      todos: new Map(),
      channels: new Map([['channel-1', makeChannel()]]),
      members: new Map([['layla', makeMember('layla')]]),
      messages: new Map(),
      taskSessions: new Map(),
    };
    const open: Todo = TodoSchema.parse({
      id: 'open-1',
      organizationId: 'org-1',
      memberId: 'layla',
      title: opts.deliverable ?? 'compile the development task list',
      status: 'in_progress',
      notes: '',
      channelId: 'channel-1',
      sourceMessageId: 'commit-msg',
      deliverableSummary: opts.deliverable ?? 'compile the development task list',
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      lastProgressAt: new Date().toISOString(),
      emptyWakeCount: 0,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
    state.todos.set(open.id, open);
    const repo = buildMockRepo(state);
    const service = new CommitmentService(
      repo,
      buildMockConversations(),
      buildMockRealtime(),
      vi.fn(),
      {},
    );
    return { service, state };
  }

  it('closes an open commitment when the agent posts a substantive past-tense delivery inline', async () => {
    const { service, state } = setupWithOpenCommitment();
    const body =
      "I have compiled the development task list. Here is the breakdown: " +
      "1. Auth + session handling. 2. Payslip viewer. 3. Surveys module. " +
      "4. Org chart visualisation. Each section ships with unit + integration tests.";
    await service.onAgentMessagePublished(makeMessage({ id: 'm-deliver', content: body }));
    const updated = state.todos.get('open-1');
    expect(updated?.status).toBe('completed');
  });

  it('uses "Here is the X" inline delivery shape', async () => {
    const { service, state } = setupWithOpenCommitment({ deliverable: 'BRD for the analytics product' });
    const body =
      "Here is the BRD for the analytics product. It covers requirements, " +
      "data sources, integration points, and the success metrics we agreed on " +
      "in the kickoff. Let me know if anything needs tightening.";
    await service.onAgentMessagePublished(makeMessage({ id: 'm-here', content: body }));
    expect(state.todos.get('open-1')?.status).toBe('completed');
  });

  it('does NOT close an open commitment when the new body has no token overlap with the deliverable', async () => {
    const { service, state } = setupWithOpenCommitment({ deliverable: 'BRD for analytics product' });
    const body =
      "I have prepared a quick status update on a completely unrelated " +
      "infrastructure migration. The clusters are now running on the new " +
      "Kubernetes version and benchmarks look solid.";
    await service.onAgentMessagePublished(makeMessage({ id: 'm-other', content: body }));
    expect(state.todos.get('open-1')?.status).toBe('in_progress');
  });

  it('does NOT trip on a short "I have done it" message — needs substantive payload', async () => {
    const { service, state } = setupWithOpenCommitment();
    await service.onAgentMessagePublished(
      makeMessage({ id: 'm-short', content: 'I have compiled it.' }),
    );
    // 120-char threshold guards against vacuous claims of completion.
    expect(state.todos.get('open-1')?.status).toBe('in_progress');
  });
});

describe('CommitmentService.onRunCompleted — empty-wake counter', () => {
  function setupWithCommitment(opts: { dueAt?: string; emptyWakeCount?: number } = {}) {
    const state: MockRepoState = {
      todos: new Map(),
      channels: new Map([['channel-1', makeChannel()]]),
      members: new Map([['layla', makeMember('layla')]]),
      messages: new Map(),
      taskSessions: new Map(),
    };
    const futureDue = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const todo: Todo = TodoSchema.parse({
      id: 'todo-1',
      organizationId: 'org-1',
      memberId: 'layla',
      title: 'compile the task list',
      status: 'in_progress',
      notes: '',
      channelId: 'channel-1',
      sourceMessageId: 'm-1',
      deliverableSummary: 'compile the task list',
      dueAt: opts.dueAt ?? futureDue,
      lastProgressAt: new Date().toISOString(),
      emptyWakeCount: opts.emptyWakeCount ?? 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    state.todos.set(todo.id, todo);
    const repo = buildMockRepo(state);
    const realtime = buildMockRealtime();
    const service = new CommitmentService(
      repo,
      buildMockConversations(),
      realtime,
      vi.fn(),
      { maxEmptyWakes: 3 },
    );
    return { service, state, realtime, todo };
  }

  it('resets the empty-wake counter when a publishing terminator fires', async () => {
    const { service, state } = setupWithCommitment({ emptyWakeCount: 2 });
    await service.onRunCompleted(
      makeRun({
        id: 'run-1',
        sourceMessageId: 'm-1',
        terminatingTool: 'channel.post',
      }),
    );
    expect(state.todos.get('todo-1')!.emptyWakeCount).toBe(0);
  });

  it('does NOT touch the counter when channel.pass acknowledges the wake', async () => {
    const { service, state } = setupWithCommitment({ emptyWakeCount: 2 });
    await service.onRunCompleted(
      makeRun({ id: 'run-1', sourceMessageId: 'm-1', terminatingTool: 'channel.pass' }),
    );
    expect(state.todos.get('todo-1')!.emptyWakeCount).toBe(2);
  });

  it('increments the counter on an empty terminator (NULL — no publishing tool, no pass)', async () => {
    const { service, state } = setupWithCommitment({ emptyWakeCount: 0 });
    await service.onRunCompleted(
      makeRun({ id: 'run-1', sourceMessageId: 'm-1', terminatingTool: null }),
    );
    expect(state.todos.get('todo-1')!.emptyWakeCount).toBe(1);
    // First empty wake doesn't escalate yet.
    expect(state.todos.get('todo-1')!.dueAt).not.toBe(state.todos.get('todo-1')!.updatedAt);
  });

  it('escalates due_at when the counter hits maxEmptyWakes', async () => {
    const { service, state, realtime } = setupWithCommitment({ emptyWakeCount: 2 });
    const before = state.todos.get('todo-1')!.dueAt;
    await service.onRunCompleted(
      makeRun({ id: 'run-1', sourceMessageId: 'm-1', terminatingTool: null }),
    );
    const after = state.todos.get('todo-1')!;
    expect(after.emptyWakeCount).toBe(3);
    // due_at must move EARLIER — we want the deadline-letter to fire
    // on the next sweep instead of waiting 24h.
    expect(after.dueAt).toBeDefined();
    expect(new Date(after.dueAt!).getTime()).toBeLessThanOrEqual(Date.now());
    expect(after.dueAt).not.toBe(before);
    // The member.empty_wake event fires with `escalated: true`.
    const emitCalls = (realtime.emit as ReturnType<typeof vi.fn>).mock.calls;
    const escalation = emitCalls.find(
      (call) => call[0] === 'member.empty_wake' && (call[1] as { escalated?: boolean }).escalated,
    );
    expect(escalation).toBeDefined();
  });

  it('is a no-op when wakeReason is not self-followup', async () => {
    const { service, state } = setupWithCommitment({ emptyWakeCount: 0 });
    await service.onRunCompleted(
      makeRun({
        id: 'run-1',
        sourceMessageId: 'm-1',
        terminatingTool: null,
        wakeReason: 'mention',
      }),
    );
    expect(state.todos.get('todo-1')!.emptyWakeCount).toBe(0);
  });

  it('is a no-op when the run has no source_message_id (no todo to attach to)', async () => {
    const { service, state } = setupWithCommitment({ emptyWakeCount: 1 });
    // RunStateSchema requires sourceMessageId in our helper signature
    // but the service guards against a missing one; build a run with
    // a non-matching source message id to exercise that branch.
    await service.onRunCompleted(
      makeRun({ id: 'run-1', sourceMessageId: 'm-orphan', terminatingTool: null }),
    );
    expect(state.todos.get('todo-1')!.emptyWakeCount).toBe(1);
  });
});

describe('CommitmentService.sweepExpired — deadline-letter idempotency', () => {
  // Post-review regression: the deadline-letter sweep used to publish
  // FIRST and persist `status: 'expired'` second, so a crash between
  // the two left the row eligible for the next sweep and the same
  // expiration notice would publish again. The atomic
  // `claimExpiredCommitment` flips status BEFORE the publish so a
  // re-attempt simply skips already-claimed rows.

  function buildExpiredCommitmentRepo(opts: { failClaim?: boolean } = {}) {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const todo: Todo = TodoSchema.parse({
      id: 'todo-expired',
      organizationId: 'org-1',
      memberId: 'layla',
      title: 'overdue commitment',
      status: 'in_progress',
      notes: '',
      channelId: 'channel-1',
      sourceMessageId: 'm-source',
      deliverableSummary: 'overdue commitment',
      dueAt: past,
      emptyWakeCount: 3,
      createdAt: past,
      updatedAt: past,
    });
    const todos = new Map<string, Todo>([[todo.id, todo]]);
    const claimedIds = new Set<string>();
    const repo: Partial<ApiRepository> = {
      getMember: () => ({ id: 'layla', name: 'Layla' } as never),
      getChannel: () => ({ id: 'channel-1', name: 'general' } as never),
      listExpiredCommitments: () => Array.from(todos.values()).filter((t) => !claimedIds.has(t.id)),
      claimExpiredCommitment: (todoId: string, nowIso: string) => {
        if (opts.failClaim) return false;
        if (claimedIds.has(todoId)) return false;
        claimedIds.add(todoId);
        const existing = todos.get(todoId);
        if (!existing) return false;
        todos.set(
          todoId,
          TodoSchema.parse({ ...existing, status: 'expired', updatedAt: nowIso }),
        );
        return true;
      },
      saveTodo: (t) => {
        todos.set(t.id, TodoSchema.parse(t));
        return t;
      },
    };
    return { repo: repo as ApiRepository, todos };
  }

  it('claims the row before publishing — second sweep against same rows yields zero new publishes', async () => {
    const { repo, todos } = buildExpiredCommitmentRepo();
    const publish = vi.fn();
    const conversations = {
      publishMessage: publish,
    } as unknown as ConversationService;
    const realtime = buildMockRealtime();
    const service = new CommitmentService(repo, conversations, realtime, vi.fn(), {});

    const first = await service.sweepExpired();
    expect(first).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(todos.get('todo-expired')!.status).toBe('expired');

    // Second sweep — listExpiredCommitments filters out claimed rows,
    // so the row is no longer offered and no new publish occurs.
    const second = await service.sweepExpired();
    expect(second).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('skips a row whose claim fails (another sweep raced ahead)', async () => {
    const { repo } = buildExpiredCommitmentRepo({ failClaim: true });
    const publish = vi.fn();
    const conversations = {
      publishMessage: publish,
    } as unknown as ConversationService;
    const service = new CommitmentService(
      repo,
      conversations,
      buildMockRealtime(),
      vi.fn(),
      {},
    );
    const count = await service.sweepExpired();
    expect(count).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });
});
