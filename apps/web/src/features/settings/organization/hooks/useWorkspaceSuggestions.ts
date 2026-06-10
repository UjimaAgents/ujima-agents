import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSuggestionWorkspace } from "@ujima/api-schema";

export function useWorkspaceSuggestions(currentOrgId: string) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSuggestionWorkspace[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetched = useRef(false);

  const fetchSuggestions = useCallback(async () => {
    if (!currentOrgId) {
      setWorkspaces([]);
      setFetching(false);
      return;
    }

    setFetching(true);
    setError(null);
    try {
      const res = await fetch("/api/workspaces/suggestions");
      if (!res.ok) {
        if (res.status === 401) {
          setWorkspaces([]);
          return;
        }
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Failed to fetch suggestions");
      }
      const data = (await res.json()) as { workspaces: WorkspaceSuggestionWorkspace[] };
      setWorkspaces(data.workspaces ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch suggestions");
      setWorkspaces([]);
    } finally {
      setFetching(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    void fetchSuggestions();
  }, [fetchSuggestions]);

  const refresh = useCallback(() => {
    fetched.current = true;
    void fetchSuggestions();
  }, [fetchSuggestions]);

  return { workspaces, fetching, error, refresh };
}
