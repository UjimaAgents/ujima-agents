"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AgentToolGrantsResponse,
  CatalogAgentView,
  GovernancePolicyResponse,
  GrantToolResponse,
  McpCatalogResponse,
  McpCatalogServer,
  ToolClassificationResponse,
} from "@ujima/api-schema";
import type { RiskDefaults, ToolRiskClass } from "@ujima/shared";
import { emptyRiskDefaults } from "@ujima/shared";
import { settingsFetch, settingsFetchVoid } from "@/features/settings/shared/settings-api";

export interface UseMcpCatalog {
  catalogByServer: Record<string, McpCatalogServer | undefined>;
  riskDefaults: RiskDefaults;
  // Optional per-agent perspective (filled when callers pass agentId).
  agentView: Record<string, CatalogAgentView> | undefined;
  agentViewId: string | undefined;
  loading: boolean;
  error: string | null;
  refresh: (agentId?: string) => Promise<void>;
  saveRiskDefaults: (patch: Partial<RiskDefaults>) => Promise<void>;
  setToolClassification: (
    serverId: string,
    toolName: string,
    risk: ToolRiskClass,
  ) => Promise<void>;
  grantToolToAgent: (
    agentId: string,
    serverId: string,
    toolName: string,
    scope?: "worker" | "supervisor" | "both",
  ) => Promise<void>;
  revokeToolFromAgent: (
    agentId: string,
    serverId: string,
    toolName: string,
  ) => Promise<void>;
}

export function useMcpCatalog(orgId: string): UseMcpCatalog {
  const [catalogByServer, setCatalogByServer] = useState<
    Record<string, McpCatalogServer | undefined>
  >({});
  const [riskDefaults, setRiskDefaults] = useState<RiskDefaults>(emptyRiskDefaults());
  const [agentView, setAgentView] = useState<
    Record<string, CatalogAgentView> | undefined
  >(undefined);
  const [agentViewId, setAgentViewId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (agentId?: string) => {
      if (!orgId) return;
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ organizationId: orgId });
        if (agentId) qs.set("agentId", agentId);
        const data = await settingsFetch<McpCatalogResponse>(
          `/api/settings/mcps/catalog?${qs.toString()}`,
          undefined,
          "Failed to load tool catalog.",
        );
        const byServer: Record<string, McpCatalogServer> = {};
        for (const s of data.servers) byServer[s.id] = s;
        setCatalogByServer(byServer);
        setRiskDefaults(data.riskDefaults);
        setAgentView(data.agentView);
        setAgentViewId(data.agentViewId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    if (!orgId) return;
    let ignore = false;
    queueMicrotask(() => {
      if (ignore) return;
      void refresh();
      // Load risk defaults directly too in case the catalog endpoint
      // is empty (no servers yet) — admins should still see them.
      void settingsFetch<GovernancePolicyResponse>(
        `/api/settings/governance/policy?organizationId=${encodeURIComponent(orgId)}`,
        undefined,
        "Failed to load governance policy.",
      )
        .then((d) => {
          if (!ignore) setRiskDefaults(d.policy.risk_defaults);
        })
        .catch(() => undefined);
    });
    return () => {
      ignore = true;
    };
  }, [orgId, refresh]);

  const saveRiskDefaults = useCallback(
    async (patch: Partial<RiskDefaults>) => {
      const data = await settingsFetch<GovernancePolicyResponse>(
        `/api/settings/governance/policy/risk-defaults`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: orgId, riskDefaults: patch }),
        },
        "Failed to save risk defaults.",
      );
      setRiskDefaults(data.policy.risk_defaults);
      await refresh(agentViewId);
    },
    [orgId, refresh, agentViewId],
  );

  const setToolClassification = useCallback(
    async (serverId: string, toolName: string, risk: ToolRiskClass) => {
      const data = await settingsFetch<ToolClassificationResponse>(
        `/api/settings/mcps/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}/classification`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: orgId, risk }),
        },
        "Failed to update classification.",
      );
      setCatalogByServer((prev) => {
        const server = prev[serverId];
        if (!server) return prev;
        return {
          ...prev,
          [serverId]: {
            ...server,
            tools: server.tools.map((t) =>
              t.name === toolName ? data.tool : t,
            ),
          },
        };
      });
    },
    [orgId],
  );

  const grantToolToAgent = useCallback(
    async (
      agentId: string,
      serverId: string,
      toolName: string,
      scope?: "worker" | "supervisor" | "both",
    ) => {
      await settingsFetch<GrantToolResponse>(
        `/api/settings/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(serverId)}/${encodeURIComponent(toolName)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: orgId, scope }),
        },
        "Failed to grant tool.",
      );
      await refresh(agentViewId);
    },
    [orgId, refresh, agentViewId],
  );

  const revokeToolFromAgent = useCallback(
    async (agentId: string, serverId: string, toolName: string) => {
      await settingsFetchVoid(
        `/api/settings/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(serverId)}/${encodeURIComponent(toolName)}?organizationId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
        "Failed to revoke tool.",
      );
      await refresh(agentViewId);
    },
    [orgId, refresh, agentViewId],
  );

  // Convenience: load per-agent grants list directly. Used by Agents tab
  // when admins want a flat list without going through the full catalog.
  return {
    catalogByServer,
    riskDefaults,
    agentView,
    agentViewId,
    loading,
    error,
    refresh,
    saveRiskDefaults,
    setToolClassification,
    grantToolToAgent,
    revokeToolFromAgent,
  };
}

export async function fetchAgentToolGrants(
  orgId: string,
  agentId: string,
): Promise<AgentToolGrantsResponse> {
  return settingsFetch<AgentToolGrantsResponse>(
    `/api/settings/agents/${encodeURIComponent(agentId)}/tools?organizationId=${encodeURIComponent(orgId)}`,
    undefined,
    "Failed to load agent tool grants.",
  );
}
