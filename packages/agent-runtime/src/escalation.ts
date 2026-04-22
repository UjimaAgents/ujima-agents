import type { AgentDef } from '@ujima/shared';

export interface EscalationMatch {
  matched: boolean;
  condition?: string;
}

export function matchesEscalation(agent: AgentDef, text: string): EscalationMatch {
  const lower = text.toLowerCase();
  for (const c of agent.escalation.conditions) {
    if (!c) continue;
    if (evaluateCondition(c, lower, text)) {
      return { matched: true, condition: c };
    }
  }
  return { matched: false };
}

function evaluateCondition(condition: string, lowerText: string, rawText: string): boolean {
  const trimmed = condition.trim();
  if (trimmed.startsWith('/') && trimmed.endsWith('/')) {
    try {
      return new RegExp(trimmed.slice(1, -1), 'i').test(rawText);
    } catch {
      return lowerText.includes(trimmed.toLowerCase());
    }
  }
  return lowerText.includes(trimmed.toLowerCase());
}
