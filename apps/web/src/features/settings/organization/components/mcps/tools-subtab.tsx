"use client";

import { AlertTriangle, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { McpCatalogServer, McpCatalogTool } from "@ujima/api-schema";
import type { Member, ToolRiskClass } from "@ujima/shared";
import { Select } from "@/components/ui/select";
import { McpEffectiveChip } from "./mcp-effective-chip";
import { ToolDetailDrawer } from "./tool-detail-drawer";
import { ToolPolicyToggle } from "./tool-policy-toggle";
import type { UseMcpCatalog } from "./use-mcp-catalog";

interface Props {
  orgId: string;
  agents: Member[];
  catalog: UseMcpCatalog;
}

type RiskFilter = "all" | "read" | "write" | "destructive" | "needs_review";

interface ToolRow {
  tool: McpCatalogTool;
  serverId: string;
  serverName: string;
}

const RISK_DOT: Record<ToolRiskClass, string> = {
  read: "bg-emerald-500",
  write: "bg-amber-500",
  destructive: "bg-rose-500",
};

const RISK_LABEL: Record<ToolRiskClass, string> = {
  read: "read",
  write: "write",
  destructive: "destructive",
};

export function ToolsSubtab({ agents, catalog }: Props) {
  const { catalogByServer } = catalog;

  // Tools tab is the role-agnostic planning surface. If the Agents
  // tab left a role-scoped snapshot behind, reset to the union view
  // so attachedAgents/grantedAgents reflect every agent regardless
  // of role.
  useEffect(() => {
    if (catalog.agentViewId !== undefined || catalog.agentViewRole !== undefined) {
      void catalog.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allRows: ToolRow[] = useMemo(() => {
    const out: ToolRow[] = [];
    for (const server of Object.values(catalogByServer)) {
      if (!server) continue;
      for (const tool of server.tools) {
        out.push({ tool, serverId: server.id, serverName: server.name });
      }
    }
    return out;
  }, [catalogByServer]);

  const [query, setQuery] = useState("");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [selectedRow, setSelectedRow] = useState<ToolRow | null>(null);

  const counts = useMemo(() => {
    const c: Record<RiskFilter, number> = {
      all: allRows.length,
      read: 0,
      write: 0,
      destructive: 0,
      needs_review: 0,
    };
    for (const row of allRows) {
      c[row.tool.risk] += 1;
      if (row.tool.needsReview) c.needs_review += 1;
    }
    return c;
  }, [allRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows.filter(({ tool, serverId, serverName }) => {
      if (riskFilter === "needs_review" && !tool.needsReview) return false;
      if (
        riskFilter !== "all" &&
        riskFilter !== "needs_review" &&
        tool.risk !== riskFilter
      ) {
        return false;
      }
      if (serverFilter !== "all" && serverId !== serverFilter) return false;
      if (agentFilter !== "all") {
        // Per-(agent, server) exposure: if the agent is in allowlist
        // mode for THIS server, the tool only shows when explicitly
        // granted; otherwise it shows whenever the MCP is attached.
        // Driven by server.allowlistAgents so a grant on a peer tool
        // doesn't hide unrelated tools from the same agent.
        const server = catalogByServer[serverId];
        const inAllowlistMode =
          server?.allowlistAgents.includes(agentFilter) ?? false;
        const exposed = inAllowlistMode
          ? tool.grantedAgents.includes(agentFilter)
          : tool.attachedAgents.includes(agentFilter);
        if (!exposed) return false;
      }
      if (q) {
        const hay = `${tool.name} ${tool.description ?? ""} ${serverName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, query, riskFilter, serverFilter, agentFilter, catalogByServer]);

  const servers = useMemo(
    () =>
      Object.values(catalogByServer).filter(
        (s): s is McpCatalogServer => s !== undefined,
      ),
    [catalogByServer],
  );

  const needsReviewCount = counts.needs_review;
  const selectedCatalogTool = useMemo(() => {
    if (!selectedRow) return null;
    const server = catalogByServer[selectedRow.serverId];
    return server?.tools.find((t) => t.name === selectedRow.tool.name) ?? null;
  }, [selectedRow, catalogByServer]);

  if (allRows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        No tools yet. Add an MCP server and run Test to populate the catalog.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {needsReviewCount > 0 ? (
        <button
          type="button"
          onClick={() => setRiskFilter("needs_review")}
          className="flex w-full items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-800 transition hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5" />
            {needsReviewCount} {needsReviewCount === 1 ? "tool" : "tools"} need
            review. The classifier wasn&rsquo;t confident.
          </span>
          <span>Review them &rarr;</span>
        </button>
      ) : null}

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools, descriptions, or server names"
            className="w-full rounded-md border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          {(
            [
              { key: "all", label: "All" },
              { key: "read", label: "Read" },
              { key: "write", label: "Write" },
              { key: "destructive", label: "Destructive" },
              { key: "needs_review", label: "Needs review" },
            ] as const
          ).map(({ key, label }) => {
            const active = key === riskFilter;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setRiskFilter(key)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition ${
                  active
                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:border-violet-400 dark:bg-violet-950/40 dark:text-violet-200"
                    : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                <span>{label}</span>
                <span className="rounded-full bg-zinc-100 px-1.5 text-[10px] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                  {counts[key]}
                </span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={serverFilter}
              onChange={(e) => setServerFilter(e.target.value)}
              options={[
                { value: "all", label: "All servers" },
                ...servers.map((s) => ({ value: s.id, label: s.name })),
              ]}
              className="min-w-[140px]"
            />
            {agents.length > 0 ? (
              <Select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                options={[
                  { value: "all", label: "Any agent" },
                  ...agents.map((a) => ({ value: a.id, label: a.name })),
                ]}
                className="min-w-[140px]"
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Tool</th>
              <th className="px-3 py-2 font-medium">Risk</th>
              <th className="px-3 py-2 font-medium">Server</th>
              <th className="px-3 py-2 font-medium">Policy</th>
              <th className="px-3 py-2 font-medium">Agents</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {filtered.map(({ tool, serverId, serverName }) => {
              const grantedCount = tool.grantedAgents.length;
              const totalConsumers =
                grantedCount > 0 ? grantedCount : tool.attachedAgents.length;
              return (
                <tr
                  key={`${serverId}:${tool.name}`}
                  onClick={() =>
                    setSelectedRow({ tool, serverId, serverName })
                  }
                  className="cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-950/50"
                >
                  <td className="px-3 py-2 align-top">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {tool.name}
                      </span>
                      {tool.needsReview ? (
                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                      ) : null}
                    </div>
                    {tool.description ? (
                      <p className="mt-0.5 max-w-md truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {tool.description}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                      <span className={`h-1.5 w-1.5 rounded-full ${RISK_DOT[tool.risk]}`} />
                      {RISK_LABEL[tool.risk]}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-[11px] text-zinc-600 dark:text-zinc-300">
                    {serverName}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex flex-col items-start gap-1.5">
                      <ToolPolicyToggle
                        effective={tool.effective}
                        onChange={(state) =>
                          catalog.setToolRule(serverId, tool.name, state)
                        }
                      />
                      <McpEffectiveChip effective={tool.effective} />
                    </div>
                  </td>
                  <td className="px-3 py-2 align-top text-[11px] text-zinc-600 dark:text-zinc-300">
                    {totalConsumers === 0 ? (
                      <span className="text-zinc-400">—</span>
                    ) : grantedCount > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="rounded-full bg-violet-50 px-1.5 py-0.5 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                          {grantedCount} granted
                        </span>
                      </span>
                    ) : (
                      <span className="text-zinc-500">
                        {tool.attachedAgents.length} via MCP
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[11px] text-zinc-500">
                  No tools match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selectedCatalogTool && selectedRow ? (
        <ToolDetailDrawer
          tool={selectedCatalogTool}
          serverId={selectedRow.serverId}
          serverName={selectedRow.serverName}
          allowlistAgents={
            catalogByServer[selectedRow.serverId]?.allowlistAgents ?? []
          }
          agents={agents}
          catalog={catalog}
          onClose={() => setSelectedRow(null)}
        />
      ) : null}
    </div>
  );
}
