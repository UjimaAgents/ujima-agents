import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSuggestionWorkspace } from "@ujima/api-schema";
import { ClientApiError, clientFetchJson } from "@/lib/client-api";

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
      const data = await clientFetchJson<{ workspaces: WorkspaceSuggestionWorkspace[] }>(
        "/api/workspaces/suggestions",
        {},
        "Failed to fetch suggestions",
      );
      setWorkspaces(data.workspaces ?? []);
    } catch (err) {
      if (err instanceof ClientApiError && err.status === 401) {
        setWorkspaces([]);
        return;
      }
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
