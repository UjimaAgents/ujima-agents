const TURN_STATE_TTL_MS = 30 * 60_000;

interface StoredTurnState {
  value: string;
  expiresAt: number;
}

const turnStates = new Map<string, StoredTurnState>();

export function getCodexTurnState(key: string): string | undefined {
  const stored = turnStates.get(key);
  if (!stored) return undefined;
  if (stored.expiresAt <= Date.now()) {
    turnStates.delete(key);
    return undefined;
  }
  return stored.value;
}

export function setCodexTurnState(key: string, value: string): void {
  const now = Date.now();
  for (const [candidate, stored] of turnStates) {
    if (stored.expiresAt <= now) turnStates.delete(candidate);
  }
  turnStates.set(key, { value, expiresAt: now + TURN_STATE_TTL_MS });
}

export function clearCodexTurnState(key: string): void {
  turnStates.delete(key);
}
