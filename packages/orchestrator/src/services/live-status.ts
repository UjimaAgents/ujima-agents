import type { RunState, Spirit } from '@ujima/shared';

const LIVE_STATUSES = new Set(['queued', 'running', 'waiting_for_approval', 'waiting_for_input']);

export function isLiveStatus(status: string): boolean {
  return LIVE_STATUSES.has(status);
}

export function isLiveSpiritStatus(status: Spirit['status']): boolean {
  return isLiveStatus(status);
}

export function isLiveRunStatus(status: RunState['status']): boolean {
  return isLiveStatus(status);
}
