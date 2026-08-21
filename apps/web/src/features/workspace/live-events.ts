"use client";

import type { SocketEventName } from "@ujima/shared/browser";

export const WORKSPACE_LIVE_EVENT = "ujima:workspace-live-event";

export interface WorkspaceLiveEventDetail {
  event: SocketEventName;
  payload: unknown;
}

export function publishWorkspaceLiveEvent(
  event: SocketEventName,
  payload: unknown,
): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceLiveEventDetail>(WORKSPACE_LIVE_EVENT, {
      detail: { event, payload },
    }),
  );
}

export function subscribeWorkspaceLiveEvents(
  listener: (detail: WorkspaceLiveEventDetail) => void,
): () => void {
  const handleEvent = (event: Event) => {
    const detail = (event as CustomEvent<WorkspaceLiveEventDetail>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(WORKSPACE_LIVE_EVENT, handleEvent);
  return () => window.removeEventListener(WORKSPACE_LIVE_EVENT, handleEvent);
}
