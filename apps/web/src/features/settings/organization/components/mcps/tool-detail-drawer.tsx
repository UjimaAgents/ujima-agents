"use client";

import { Check, X } from "lucide-react";
import { useState } from "react";
import type { McpCatalogTool } from "@ujima/api-schema";
import type { Member, ToolRiskClass } from "@ujima/shared";
import { McpEffectiveChip } from "./mcp-effective-chip";
import { McpRiskControl } from "./mcp-risk-control";
import type { UseMcpCatalog } from "./use-mcp-catalog";

interface Props {
  tool: McpCatalogTool;
  serverId: string;
  serverName: string;
  agents: Member[];
  catalog: UseMcpCatalog;
  onClose: () => void;
}

export function ToolDetailDrawer({
  tool,
  serverId,
  serverName,
  agents,
  catalog,
  onClose,
}: Props) {
  const grantedSet = new Set(tool.grantedAgents);
  const attachedSet = new Set(tool.attachedAgents);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGrant = async (agentId: string) => {
    setError(null);
    setBusyAgent(agentId);
    try {
      await catalog.grantToolToAgent(agentId, serverId, tool.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAgent(null);
    }
  };

  const handleRevoke = async (agentId: string) => {
    setError(null);
    setBusyAgent(agentId);
    try {
      await catalog.revokeToolFromAgent(agentId, serverId, tool.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAgent(null);
    }
  };

  const handleRisk = async (next: ToolRiskClass) => {
    await catalog.setToolClassification(serverId, tool.name, next);
  };

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-zinc-950/30 backdrop-blur-sm"
      />
      <aside
        role="dialog"
        aria-label={`Permissions for ${tool.name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-start justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {tool.name}
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {serverName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          {tool.description ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-300">
              {tool.description}
            </p>
          ) : null}

          <section className="space-y-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Risk classification
            </h4>
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                source: {tool.source}
                {tool.needsReview ? (
                  <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    needs review
                  </span>
                ) : null}
              </div>
              <McpRiskControl
                value={tool.risk}
                source={tool.source}
                onChange={handleRisk}
              />
            </div>
          </section>

          <section className="space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-900">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Org default decision
            </h4>
            <McpEffectiveChip effective={tool.effective} />
            {tool.effective.reason ? (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {tool.effective.reason}
              </p>
            ) : null}
          </section>

          <section className="space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-900">
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Granted to agents
              </h4>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                Granting a single tool auto-attaches the MCP server and
                shrinks the agent&rsquo;s prompt palette to only granted tools.
              </p>
            </div>

            {agents.length === 0 ? (
              <p className="text-[11px] text-zinc-500">No agents yet.</p>
            ) : (
              <ul className="space-y-1">
                {agents.map((agent) => {
                  const granted = grantedSet.has(agent.id);
                  const attachedOnly = !granted && attachedSet.has(agent.id);
                  const busy = busyAgent === agent.id;
                  return (
                    <li
                      key={agent.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-xs dark:border-zinc-800"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                          {agent.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                          {granted ? (
                            <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300">
                              <Check className="h-2.5 w-2.5" /> tool granted
                            </span>
                          ) : attachedOnly ? (
                            <span>
                              MCP attached &middot; sees all tools
                            </span>
                          ) : (
                            <span>no access</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          granted
                            ? void handleRevoke(agent.id)
                            : void handleGrant(agent.id)
                        }
                        className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                          granted
                            ? "border border-zinc-200 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
                            : "bg-violet-600 text-white hover:bg-violet-700"
                        } ${busy ? "opacity-60" : ""}`}
                      >
                        {busy ? "…" : granted ? "Revoke" : attachedOnly ? "Pin to tool" : "Grant"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {attachedSet.size > 0 && grantedSet.size === 0 ? (
              <p className="rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                Tip: this server is attached to {attachedSet.size}{" "}
                {attachedSet.size === 1 ? "agent" : "agents"} but no per-tool
                grants exist. Those agents see every tool on this server.
                Granting one tool flips them to allowlist mode and shrinks
                their prompt.
              </p>
            ) : null}

            {error ? (
              <p className="text-[11px] text-rose-600 dark:text-rose-400">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      </aside>
    </>
  );
}
