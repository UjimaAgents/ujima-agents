"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { buildCatalogUrl } from "./build-catalog-url";

export type CatalogRole = "worker" | "supervisor";

export interface UseMcpCatalog {
  catalogByServer: Record<string, McpCatalogServer | undefined>;
  riskDefaults: RiskDefaults;
  // Optional per-agent perspective (filled when callers pass agentId).
  agentView: Record<string, CatalogAgentView> | undefined;
  agentViewId: string | undefined;
  // Role that backs the current catalog snapshot. Undefined = role-
  // agnostic union (the planning view used by the Tools tab).
  agentViewRole: CatalogRole | undefined;
  loading: boolean;
  error: string | null;
  refresh: (agentId?: string, role?: CatalogRole) => Promise<void>;
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
  const [agentViewRole, setAgentViewRole] = useState<CatalogRole | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep refs of the current view selectors so post-mutation refreshes
  // can hit the same (agentId, role) snapshot without invalidating
  // every callback identity (avoiding cascade re-renders).
  const viewIdRef = useRef<string | undefined>(undefined);
  const viewRoleRef = useRef<CatalogRole | undefined>(undefined);
  useEffect(() => {
    viewIdRef.current = agentViewId;
  }, [agentViewId]);
  useEffect(() => {
    viewRoleRef.current = agentViewRole;
  }, [agentViewRole]);

  const refresh = useCallback(
    async (agentId?: string, role?: CatalogRole) => {
      if (!orgId) return;
      setLoading(true);
      setError(null);
      try {
        const data = await settingsFetch<McpCatalogResponse>(
          buildCatalogUrl({ orgId, agentId, role }),
          undefined,
          "Failed to load tool catalog.",
        );
        const byServer: Record<string, McpCatalogServer> = {};
        for (const s of data.servers) byServer[s.id] = s;
        setCatalogByServer(byServer);
        setRiskDefaults(data.riskDefaults);
        setAgentView(data.agentView);
        setAgentViewId(data.agentViewId);
        setAgentViewRole(role);
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
      await refresh(viewIdRef.current, viewRoleRef.current);
    },
    [orgId, refresh],
  );

  const setToolClassification = useCallback(
    async (serverId: string, toolName: string, risk: ToolRiskClass) => {
      await settingsFetch<ToolClassificationResponse>(
        `/api/settings/mcps/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}/classification`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: orgId, risk }),
        },
        "Failed to update classification.",
      );
      // Classification edits also shift the effective decision per
      // agent (risk_defaults route through risk class) so the agent
      // view/allowlist state must be recomputed. Pre-fix only the
      // single tool row was patched and the agent perspectives stayed
      // stale until the next unrelated refresh.
      await refresh(viewIdRef.current, viewRoleRef.current);
    },
    [orgId, refresh],
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
      await refresh(viewIdRef.current, viewRoleRef.current);
    },
    [orgId, refresh],
  );

  const revokeToolFromAgent = useCallback(
    async (agentId: string, serverId: string, toolName: string) => {
      await settingsFetchVoid(
        `/api/settings/agents/${encodeURIComponent(agentId)}/tools/${encodeURIComponent(serverId)}/${encodeURIComponent(toolName)}?organizationId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
        "Failed to revoke tool.",
      );
      await refresh(viewIdRef.current, viewRoleRef.current);
    },
    [orgId, refresh],
  );

  // Convenience: load per-agent grants list directly. Used by Agents tab
  // when admins want a flat list without going through the full catalog.
  return {
    catalogByServer,
    riskDefaults,
    agentView,
    agentViewId,
    agentViewRole,
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
