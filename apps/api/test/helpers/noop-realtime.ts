import type { RealtimeService } from '@ujima/orchestrator';

export function noopRealtime(): RealtimeService {
  return { emit: () => undefined };
}
