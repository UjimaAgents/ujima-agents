"use client";

import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  CatalogAgentView,
  McpCatalogServer,
  McpCatalogTool,
} from "@ujima/api-schema";
import type { Member, ToolRiskClass } from "@ujima/shared";
import type { CatalogRole, UseMcpCatalog } from "./use-mcp-catalog";
import { McpEffectiveChip } from "./mcp-effective-chip";

interface Props {
  orgId: string;
  agents: Member[];
  catalog: UseMcpCatalog;
}

const RISK_DOT: Record<ToolRiskClass, string> = {
  read: "bg-emerald-500",
  write: "bg-amber-500",
  destructive: "bg-rose-500",
};

export function AgentsSubtab({ agents, catalog }: Props) {
  const [activeAgentId, setActiveAgentId] = useState<string>(agents[0]?.id ?? "");
  // Role drives the catalog's exposure decisions: worker-only grants
  // and supervisor-only attachments are scoped at the runtime
  // resolver, so the UI mirrors that here. Defaults to 'worker' since
  // worker is the predominant spirit role.
  const [role, setRole] = useState<CatalogRole>("worker");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Re-fetch catalog with the (agent, role) perspective whenever
  // either selector changes so `exposed` + per-agent decisions
  // match exactly what listAttachedServersForSpirit would return.
  useEffect(() => {
    if (!activeAgentId) return;
    void catalog.refresh(activeAgentId, role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgentId, role]);

  const servers = useMemo(
    () =>
      Object.values(catalog.catalogByServer).filter(
        (s): s is McpCatalogServer => s !== undefined,
      ),
    [catalog.catalogByServer],
  );

  const lookupView = (serverId: string, toolName: string) =>
    catalog.agentView?.[`${serverId}::${toolName}`];

  // Per-server: counts that surface in the section header.
  const summaries = useMemo(() => {
    return servers.map((server) => {
      let exposed = 0;
      let granted = 0;
      for (const tool of server.tools) {
        const v = lookupView(server.id, tool.name);
        if (v?.exposed) exposed += 1;
        if (tool.grantedAgents.includes(activeAgentId)) granted += 1;
      }
      const inAllowlistMode = granted > 0;
      return {
        server,
        exposed,
        granted,
        inAllowlistMode,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, catalog.agentView, activeAgentId]);

  const handleGrant = async (serverId: string, toolName: string) => {
    setError(null);
    setBusy(`${serverId}:${toolName}`);
    try {
      await catalog.grantToolToAgent(activeAgentId, serverId, toolName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (serverId: string, toolName: string) => {
    setError(null);
    setBusy(`${serverId}:${toolName}`);
    try {
      await catalog.revokeToolFromAgent(activeAgentId, serverId, toolName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        No agents yet. Add an agent in Team &rarr; Agents &amp; Roles first.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
      <aside className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="border-b border-zinc-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Agents
        </div>
        <ul>
          {agents.map((agent) => {
            const active = agent.id === activeAgentId;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  onClick={() => setActiveAgentId(agent.id)}
                  className={`block w-full truncate px-3 py-2 text-left text-xs transition ${
                    active
                      ? "bg-violet-50 font-semibold text-violet-900 dark:bg-violet-950/40 dark:text-violet-200"
                      : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-900"
                  }`}
                >
                  {agent.name}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>Spirit role drives what the agent&rsquo;s model actually sees.</span>
          <div
            role="radiogroup"
            aria-label="Spirit role"
            className="inline-flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800"
          >
            {(["worker", "supervisor"] as const).map((opt) => {
              const selected = opt === role;
              return (
                <button
                  key={opt}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setRole(opt)}
                  className={`px-2 py-1 capitalize transition ${
                    selected
                      ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        {summaries.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No servers in this org yet.
          </p>
        ) : (
          summaries.map(({ server, exposed, granted, inAllowlistMode }) => {
            const isOpen = expanded[server.id] ?? false;
            return (
              <div
                key={server.id}
                className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((p) => ({ ...p, [server.id]: !isOpen }))
                  }
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-zinc-50 dark:hover:bg-zinc-950"
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
                    )}
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                      {server.name}
                    </span>
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {server.tools.length} tools
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    {inAllowlistMode ? (
                      <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                        {granted} granted
                      </span>
                    ) : exposed > 0 ? (
                      <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                        all tools exposed
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-50 px-1.5 py-0.5 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                        no access
                      </span>
                    )}
                  </div>
                </button>

                {isOpen ? (
                  // overflow-x-auto so the action column (Grant/Revoke/Pin)
                  // never gets clipped by the rounded-card overflow-hidden
                  // when descriptions are long.
                  <div className="overflow-x-auto border-t border-zinc-100 dark:border-zinc-900">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Tool</th>
                          <th className="px-3 py-1.5 font-medium">Risk</th>
                          <th className="px-3 py-1.5 font-medium">Decision</th>
                          <th className="px-3 py-1.5 font-medium">Exposed</th>
                          <th className="px-3 py-1.5 font-medium" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
                        {server.tools.map((tool) =>
                          renderToolRow({
                            tool,
                            serverId: server.id,
                            view: lookupView(server.id, tool.name),
                            activeAgentId,
                            busy,
                            inAllowlistMode,
                            onGrant: handleGrant,
                            onRevoke: handleRevoke,
                          }),
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function renderToolRow(args: {
  tool: McpCatalogTool;
  serverId: string;
  view: CatalogAgentView | undefined;
  activeAgentId: string;
  busy: string | null;
  inAllowlistMode: boolean;
  onGrant: (s: string, t: string) => void;
  onRevoke: (s: string, t: string) => void;
}) {
  const { tool, serverId, view, activeAgentId, busy, inAllowlistMode, onGrant, onRevoke } = args;
  const granted = tool.grantedAgents.includes(activeAgentId);
  const isBusy = busy === `${serverId}:${tool.name}`;
  const exposed = view?.exposed ?? false;
  const effective = view
    ? { state: view.state, source: view.source, reason: view.reason }
    : tool.effective;
  return (
    <tr key={`${serverId}:${tool.name}`}>
      <td className="max-w-[260px] px-3 py-1.5 align-top">
        <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
          {tool.name}
        </div>
        {tool.description ? (
          <div className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
            {tool.description}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-1.5 align-top">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
          <span className={`h-1.5 w-1.5 rounded-full ${RISK_DOT[tool.risk]}`} />
          {tool.risk}
        </span>
      </td>
      <td className="px-3 py-1.5 align-top">
        <McpEffectiveChip effective={effective} />
      </td>
      <td className="px-3 py-1.5 align-top text-[11px]">
        {exposed ? (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
            <Check className="h-3 w-3" /> yes
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
            <X className="h-3 w-3" /> no
          </span>
        )}
      </td>
      <td className="px-3 py-1.5 align-top text-right">
        <button
          type="button"
          disabled={isBusy}
          onClick={() =>
            granted
              ? onRevoke(serverId, tool.name)
              : onGrant(serverId, tool.name)
          }
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
            granted
              ? "border border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
              : "bg-violet-600 text-white hover:bg-violet-700"
          } ${isBusy ? "opacity-60" : ""}`}
        >
          {isBusy
            ? "…"
            : granted
              ? "Revoke"
              : inAllowlistMode
                ? "Grant"
                : "Pin"}
        </button>
      </td>
    </tr>
  );
}
