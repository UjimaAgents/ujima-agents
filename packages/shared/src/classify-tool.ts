import type { ToolRiskClass } from './governance-policy.js';

// Deterministic verb-set classifier. Conservative bias: ambiguous → write
// + needsReview, never read.

/** Tokens that signal a tool only observes state. */
export const READ_VERBS: ReadonlySet<string> = new Set([
  'get',
  'list',
  'read',
  'search',
  'find',
  'query',
  'inspect',
  'snapshot',
  'describe',
  'browse',
  'fetch',
  'view',
  'show',
  'head',
  'status',
  'diff',
  'log',
  'count',
  'exists',
  'has',
  'peek',
  'preview',
  'check',
  'lookup',
]);

/** Tokens that signal a recoverable, scoped mutation. */
export const WRITE_VERBS: ReadonlySet<string> = new Set([
  'create',
  'update',
  'set',
  'patch',
  'put',
  'write',
  'add',
  'append',
  'edit',
  'modify',
  'save',
  'upload',
  'attach',
  'rename',
  'tag',
  'assign',
  'open',
  'start',
  'navigate',
  'click',
  'type',
  'select',
  'fill',
  'hover',
  'screenshot',
  'capture',
  'wait',
  'handle',
  'resize',
  'close', // closing a tab/window is recoverable; destructive uses 'kill'
]);

/**
 * Tokens that signal irreversible action, scope escape, or arbitrary
 * code execution. Some of these overlap with WRITE_VERBS (`post`,
 * `push`) — the category disambiguator below breaks the tie.
 */
export const DESTRUCTIVE_VERBS: ReadonlySet<string> = new Set([
  // data loss
  'delete',
  'remove',
  'drop',
  'truncate',
  'purge',
  'wipe',
  'destroy',
  'erase',
  // irreversible state
  'reset',
  'revoke',
  'kill',
  'force',
  'overwrite',
  'clobber',
  // arbitrary code
  'execute',
  'eval',
  'exec',
  'spawn',
  'shell',
  'unsafe',
  // outbound / scope-escaping
  'send',
  'post',
  'publish',
  'broadcast',
  'notify',
  'email',
  'sms',
  'push',
  'merge',
  'deploy',
  'release',
  'rollout',
  'approve',
]);

/**
 * Category contexts in which a token's destructive intent is reduced
 * to write-level (drag-and-drop in browser, "post" to a non-messaging
 * surface, etc.). Empty set → token stays destructive regardless of
 * category.
 */
const DESTRUCTIVE_DISAMBIG: Record<string, ReadonlySet<string>> = {
  drop: new Set(['browser']),
  post: new Set(['browser', 'database']),
  push: new Set(['browser']),
  run: new Set(['browser']),
};

/**
 * Tokens that only become destructive in combination with another
 * token. Maps a primary token to a set of qualifiers; when both are
 * present, the call is destructive regardless of category.
 */
const DESTRUCTIVE_COMBOS: Record<string, ReadonlySet<string>> = {
  run: new Set(['code', 'js', 'sql', 'shell', 'script', 'unsafe', 'query', 'command']),
};

/**
 * Description regexes that promote the class to destructive.
 *
 * `drop` is deliberately excluded from the bare-verb pattern because
 * "drop files onto an element" is a benign UI gesture; the destructive
 * sense is captured via the category disambiguator on the name token.
 * The remaining verbs (delete, wipe, purge, destroy) are unambiguous.
 */
const DESCRIPTION_DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\b(permanently|cannot be undone|irreversible)\b/i,
  /\b(deletes?|wipes?|purges?|destroys?)\b/i,
  /\bdrop\s+(table|database|schema|index|view|column)\b/i,
  /\b(arbitrary code|eval(?:uates?)?(?: javascript)?|execute javascript|shell|rce|unsafe)\b/i,
  /\bforce[- ]push\b/i,
];

/** Description regex hints that nudge unknown tools to `read`. */
const DESCRIPTION_READ_PATTERNS: readonly RegExp[] = [
  /\b(returns?|fetches?|lists?|gets?|reads?|inspects?|describes?)\b/i,
];

/** Description words that flag `needsReview`. */
const HEDGING_PATTERN = /\b(maybe|experimental|beta|unsafe|dangerous|preview)\b/i;

export interface ClassifyInput {
  name: string;
  description?: string;
  /** MCP server category — disambiguates ambiguous verbs (e.g. `drop`). */
  category?: string;
  /** Curator hint: force `destructive` when `name` matches. */
  knownDestructiveTools?: readonly string[];
  /** Server-declared destructive flag. */
  declaredDestructive?: boolean;
}

export interface ClassifyOutput {
  risk: ToolRiskClass;
  /**
   * Confidence: 'high' (clean verb hit), 'medium' (description hint or
   * disambiguator demoted destructive→write), 'low' (no signal, fell
   * through to default).
   */
  confidence: 'high' | 'medium' | 'low';
  needsReview: boolean;
  /** Short human-readable trace of why this class was picked. */
  reason: string;
}

export function classifyTool(input: ClassifyInput): ClassifyOutput {
  const name = input.name ?? '';
  const description = input.description ?? '';
  const category = (input.category ?? '').toLowerCase();
  const tokens = tokenise(name);

  if (input.declaredDestructive || input.knownDestructiveTools?.includes(name)) {
    return {
      risk: 'destructive',
      confidence: 'high',
      needsReview: false,
      reason: 'registry hint or descriptor flag',
    };
  }

  // Verb sweep — destructive first, then read, then write.
  for (const token of tokens) {
    if (DESTRUCTIVE_VERBS.has(token)) {
      // Combo qualifier: `run` is only destructive when paired with
      // `code` / `sql` / etc. If a combo is required and missing,
      // skip this signal (the rest of the sweep continues).
      const combo = DESTRUCTIVE_COMBOS[token];
      if (combo && !tokens.some((t) => combo.has(t))) {
        continue;
      }
      const demote = DESTRUCTIVE_DISAMBIG[token];
      if (demote && demote.has(category)) {
        // Demoted to write by category context. Description may still
        // promote back to destructive below.
        const promoted = matchesDestructive(description);
        if (promoted) {
          return {
            risk: 'destructive',
            confidence: 'high',
            needsReview: false,
            reason: `${token} + description match (${category} demote overruled)`,
          };
        }
        return {
          risk: 'write',
          confidence: 'medium',
          needsReview: false,
          reason: `${token} demoted to write in ${category} category`,
        };
      }
      return {
        risk: 'destructive',
        confidence: 'high',
        needsReview: false,
        reason: `name contains ${token}`,
      };
    }
  }

  // Description scan can still promote a read/write candidate to destructive.
  const descDestructive = matchesDestructive(description);

  for (const token of tokens) {
    if (READ_VERBS.has(token)) {
      if (descDestructive) {
        return {
          risk: 'destructive',
          confidence: 'high',
          needsReview: false,
          reason: 'description matches destructive pattern',
        };
      }
      return {
        risk: 'read',
        confidence: 'high',
        needsReview: false,
        reason: `name contains ${token}`,
      };
    }
  }

  for (const token of tokens) {
    if (WRITE_VERBS.has(token)) {
      if (descDestructive) {
        return {
          risk: 'destructive',
          confidence: 'high',
          needsReview: false,
          reason: 'description matches destructive pattern',
        };
      }
      return {
        risk: 'write',
        confidence: 'high',
        needsReview: HEDGING_PATTERN.test(description),
        reason: `name contains ${token}`,
      };
    }
  }

  if (descDestructive) {
    return {
      risk: 'destructive',
      confidence: 'high',
      needsReview: false,
      reason: 'description matches destructive pattern',
    };
  }

  // Description scan can rescue obvious read tools whose name uses an
  // off-vocabulary verb (e.g. `accessibility_tree`).
  if (DESCRIPTION_READ_PATTERNS.some((re) => re.test(description))) {
    return {
      risk: 'read',
      confidence: 'medium',
      needsReview: true,
      reason: 'description matches read pattern (no verb hit on name)',
    };
  }

  return {
    risk: 'write',
    confidence: 'low',
    needsReview: true,
    reason: 'no signal; defaulted to write + needs review',
  };
}

/** Split a tool name on `_`, `-`, `/`, and camelCase boundaries. */
export function tokenise(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\-/\s]+/g)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

function matchesDestructive(description: string): boolean {
  if (!description) return false;
  return DESCRIPTION_DESTRUCTIVE_PATTERNS.some((re) => re.test(description));
}
