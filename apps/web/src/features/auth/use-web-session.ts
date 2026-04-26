"use client";

import { useSyncExternalStore } from "react";
import { readWebSession, subscribeToWebSession } from "./web-session";

export function useWebSession() {
  return useSyncExternalStore(subscribeToWebSession, readWebSession, () => null);
}
