import type { ActivityEvent, RunChunkEvent } from "@ujima/shared/browser";

export function getRunChunkPayload(event: ActivityEvent): RunChunkEvent | undefined {
  if (event.type !== "run_chunk") return undefined;
  const payload = event.payload as Partial<RunChunkEvent> | undefined;
  if (!payload?.runId || !payload.agentId || !payload.kind) return undefined;
  return payload as RunChunkEvent;
}

export function runChunkActivityKey(event: ActivityEvent): string | undefined {
  const payload = getRunChunkPayload(event);
  return payload ? `${payload.runId}:${payload.agentId}:${payload.kind}` : undefined;
}

export function mergeRunChunkActivity(existing: ActivityEvent, incoming: ActivityEvent): ActivityEvent {
  const existingPayload = getRunChunkPayload(existing);
  const incomingPayload = getRunChunkPayload(incoming);
  return {
    ...existing,
    payload: {
      ...existing.payload,
      delta: `${existingPayload?.delta ?? ""}${incomingPayload?.delta ?? ""}`,
    },
  };
}

export function collapseRunChunkActivities(activity: ActivityEvent[]): ActivityEvent[] {
  const collapsed: ActivityEvent[] = [];
  for (const event of activity) {
    if (event.type !== "run_chunk") {
      collapsed.push(event);
      continue;
    }
    const previous = collapsed[collapsed.length - 1];
    const key = runChunkActivityKey(event);
    if (previous?.type === "run_chunk" && key && runChunkActivityKey(previous) === key) {
      collapsed[collapsed.length - 1] = mergeRunChunkActivity(previous, event);
      continue;
    }
    collapsed.push(event);
  }
  return collapsed;
}
