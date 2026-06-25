"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AgentMcpAttachmentResponse,
  AgentToolGrantsResponse,
  CatalogAgentView,
  GovernancePolicyResponse,
  GrantToolResponse,
  McpCatalogResponse,
  McpCatalogServer,
  ToolClassificationResponse,
} from "@ujima/api-schema";
import type { McpAttachmentTier, RiskDefaults, ToolRiskClass } from "@ujima/shared";
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
  /**
   * Set the org-wide decision for a single (server, tool). Writes a
   * platform rule into the governance policy the gate evaluates.
   * `inherit` clears the rule so the tool falls back to risk defaults.
   */
  setToolRule: (
    serverId: string,
    toolName: string,
    state: "allow" | "require_approval" | "deny" | "inherit",
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
  /**
   * PR 6 — flip the agent's attachment tier on a server. Updates the
   * (member, server) attachment row to 'native' (typed-palette path)
   * or 'dispatch' (meta-tool dispatch path). Harmless metadata when
   * the V2 spawn flag is off — the legacy path is tier-blind.
   */
  updateAttachmentTier: (
    agentId: string,
    serverId: string,
    tier: McpAttachmentTier,
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

  // Refs of the current view selectors so post-mutation refreshes
  // can hit the same (agentId, role) snapshot without invalidating
  // every callback identity (avoiding cascade re-renders). Updated
  // synchronously during refresh() so a mutation fired immediately
  // after a switch sees the latest selectors instead of the
  // previous-render values that a useEffect would have captured.
  const viewIdRef = useRef<string | undefined>(undefined);
  const viewRoleRef = useRef<CatalogRole | undefined>(undefined);

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
        // Mirror into refs synchronously so any mutator fired before
        // React commits the state update sees the freshest selectors.
        viewIdRef.current = data.agentViewId;
        viewRoleRef.current = role;
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

  // Shared tail for the governance-policy PATCH routes (risk-defaults +
  // per-tool rule): same response shape, same local-state resync. Keeping it
  // in one place stops the two mutations from drifting in how they update
  // riskDefaults / which refresh args they pass.
  const patchGovernancePolicy = useCallback(
    async (path: string, body: Record<string, unknown>, errorMessage: string) => {
      const data = await settingsFetch<GovernancePolicyResponse>(
        path,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: orgId, ...body }),
        },
        errorMessage,
      );
      setRiskDefaults(data.policy.risk_defaults);
      await refresh(viewIdRef.current, viewRoleRef.current);
    },
    [orgId, refresh],
  );

  const saveRiskDefaults = useCallback(
    (patch: Partial<RiskDefaults>) =>
      patchGovernancePolicy(
        `/api/settings/governance/policy/risk-defaults`,
        { riskDefaults: patch },
        "Failed to save risk defaults.",
      ),
    [patchGovernancePolicy],
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

  const setToolRule = useCallback(
    (
      serverId: string,
      toolName: string,
      state: "allow" | "require_approval" | "deny" | "inherit",
    ) =>
      patchGovernancePolicy(
        `/api/settings/governance/policy/tool-rule`,
        { mcpId: serverId, toolName, state },
        "Failed to update tool rule.",
      ),
    [patchGovernancePolicy],
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

  const updateAttachmentTier = useCallback(
    async (agentId: string, serverId: string, tier: McpAttachmentTier) => {
      await settingsFetch<AgentMcpAttachmentResponse>(
        `/api/settings/agents/${encodeURIComponent(agentId)}/mcps/${encodeURIComponent(serverId)}/tier`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: orgId, tier }),
        },
        "Failed to update connector tier.",
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
    setToolRule,
    grantToolToAgent,
    revokeToolFromAgent,
    updateAttachmentTier,
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
