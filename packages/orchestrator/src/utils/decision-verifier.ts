import type { Message } from '@ujima/shared';
import { AGENT_KIND } from '@ujima/shared';
import type {
  ChannelPassReason,
  DecisionVerificationFailure,
} from '@ujima/shared';
import type { ConversationRepository } from '../services/repository-reader.js';
import { isDirectMessageThread } from '@ujima/shared';

/**
 * Shadow-mode verifier for `channel.pass` decisions.
 *
 * Reads ground truth from the repo and returns a verification
 * result without enforcing. Provider-agnostic by design — every
 * check is pure SQL/regex against thread state, no LLM
 * involvement.
 *
 * Per the convergent expert recommendation: run this in shadow
 * mode for one week, collect a labeled dataset, then decide
 * whether to hard-reject the top-offending failure kinds.
 *
 * TOCTOU note: the verifier reads thread state at decision time.
 * Under broad-wake N=N agents, two agents may both pass the
 * `already_handled` check because neither has yet committed.
 * Acceptable in shadow mode — the data point is "agent claimed
 * X at time T", not "agent's claim was true forever." When we
 * graduate from shadow to enforcement, we re-verify at commit
 * time inside `publishMessage`'s transaction.
 */

export interface VerifyChannelPassInput {
  organizationId: string;
  agentId: string;
  agentName?: string;
  threadId: string;
  reason: ChannelPassReason;
  citedMessageIds?: string[];
  quotedText?: string;
  sourceMessageId?: string | null;
}

export interface VerificationResult {
  verified: boolean;
  failureKinds: DecisionVerificationFailure[];
}

const ALL_PASS: VerificationResult = { verified: true, failureKinds: [] };

function fail(...kinds: DecisionVerificationFailure[]): VerificationResult {
  return { verified: false, failureKinds: kinds };
}

export function verifyChannelPass(
  input: VerifyChannelPassInput,
  repo: ConversationRepository,
): VerificationResult {
  switch (input.reason) {
    case 'not_addressed_to_me':
      return verifyNotAddressedToMe(input, repo);
    case 'already_handled':
      return verifyAlreadyHandled(input, repo);
    case 'duplicate_reply':
      return verifyDuplicateReply(input, repo);
    case 'awaiting_human':
      return verifyAwaitingHuman(input, repo);
    case 'out_of_scope':
      // Unverifiable from thread state alone — needs role intent
      // matching. Always returns verified=true in shadow mode.
      return ALL_PASS;
    default:
      return ALL_PASS;
  }
}

function verifyNotAddressedToMe(
  input: VerifyChannelPassInput,
  repo: ConversationRepository,
): VerificationResult {
  const sourceMessage = resolveSourceMessage(input, repo);
  if (!sourceMessage) return ALL_PASS;
  const failures: DecisionVerificationFailure[] = [];

  if (
    isDirectMessageThread(input.threadId) &&
    sourceMessage.senderId !== input.agentId
  ) {
    failures.push('not_addressed_to_me_in_direct_message');
  }

  if ((sourceMessage.mentions ?? []).includes(input.agentId)) {
    failures.push('not_addressed_to_me_but_self_was_mentioned');
  }

  if (input.agentName) {
    const tokens = input.agentName.split(/\s+/).filter((t) => t.length >= 2);
    for (const token of tokens) {
      const safe = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(^|[^@\\w])${safe}\\b`, 'i');
      if (pattern.test(sourceMessage.content)) {
        failures.push('not_addressed_to_me_but_name_referenced');
        break;
      }
    }
  }

  return failures.length > 0 ? fail(...failures) : ALL_PASS;
}

function verifyAlreadyHandled(
  input: VerifyChannelPassInput,
  repo: ConversationRepository,
): VerificationResult {
  const failures: DecisionVerificationFailure[] = [];
  const sourceMessage = resolveSourceMessage(input, repo);
  const recent = listRecentMessages(input.organizationId, input.threadId, repo);

  // Does at least one other agent have a post AFTER the source?
  if (sourceMessage) {
    const afterSource = recent.filter(
      (m) =>
        m.createdAt > sourceMessage.createdAt &&
        m.senderKind === AGENT_KIND &&
        m.senderId !== input.agentId &&
        m.content.trim().length > 0,
    );
    if (afterSource.length === 0) {
      failures.push('already_handled_but_no_prior_responder');
    }
  }

  // If the model cited specific messages, do they exist?
  if (input.citedMessageIds && input.citedMessageIds.length > 0) {
    const byId = new Map(recent.map((m) => [m.id, m]));
    const missingCitations = input.citedMessageIds.filter((id) => !byId.has(id));
    if (missingCitations.length > 0) {
      failures.push('already_handled_cited_message_not_found');
    }

    // If the model also quoted text, verify it appears in at least
    // one cited message. Pure substring match — paraphrase bypasses
    // this, but verbatim fabrication is caught deterministically.
    if (input.quotedText && input.quotedText.trim().length > 0) {
      const haystack = input.citedMessageIds
        .map((id) => byId.get(id)?.content ?? '')
        .join('\n');
      const needle = input.quotedText.trim();
      if (haystack.length > 0 && !haystack.includes(needle)) {
        failures.push('already_handled_quoted_text_not_present');
      }
    }
  }

  return failures.length > 0 ? fail(...failures) : ALL_PASS;
}

function verifyDuplicateReply(
  input: VerifyChannelPassInput,
  repo: ConversationRepository,
): VerificationResult {
  const failures: DecisionVerificationFailure[] = [];
  const recent = listRecentMessages(input.organizationId, input.threadId, repo);

  // Has THIS agent posted to the thread recently?
  const selfMessages = recent.filter(
    (m) => m.senderId === input.agentId && m.senderKind === AGENT_KIND,
  );
  if (selfMessages.length === 0) {
    failures.push('duplicate_reply_but_no_prior_self_message');
  }

  if (input.citedMessageIds && input.citedMessageIds.length > 0) {
    const byId = new Map(recent.map((m) => [m.id, m]));
    if (input.citedMessageIds.some((id) => !byId.has(id))) {
      failures.push('duplicate_reply_cited_message_not_found');
    }
  }

  return failures.length > 0 ? fail(...failures) : ALL_PASS;
}

function verifyAwaitingHuman(
  input: VerifyChannelPassInput,
  repo: ConversationRepository,
): VerificationResult {
  const recent = listRecentMessages(input.organizationId, input.threadId, repo);
  if (recent.length === 0) return ALL_PASS;
  const last = recent[recent.length - 1];
  if (!last) return ALL_PASS;
  if (last.senderKind === 'human' && last.kind === 'human') {
    return fail('awaiting_human_but_last_message_was_human');
  }
  return ALL_PASS;
}

function resolveSourceMessage(
  input: VerifyChannelPassInput,
  repo: ConversationRepository,
): Message | null {
  return input.sourceMessageId
    ? repo.getMessage(input.organizationId, input.sourceMessageId)
    : null;
}

function listRecentMessages(
  organizationId: string,
  threadId: string,
  repo: ConversationRepository,
  limit = 50,
): Message[] {
  const page = repo.listMessages(organizationId, threadId, undefined, limit);
  return [...page.data].sort((left, right) => {
    const byTime = left.createdAt.localeCompare(right.createdAt);
    return byTime !== 0 ? byTime : left.id.localeCompare(right.id);
  });
}
