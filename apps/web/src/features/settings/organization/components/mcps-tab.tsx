"use client";

import { ChevronDown, ChevronRight, Plug, Plus, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, memo } from "react";
import type {
  AgentMcpAttachmentsResponse,
  McpServerListResponse,
  McpToolsResponse,
  TestMcpResponse,
} from "@ujima/api-schema";
import type { AgentMcpAttachment, McpServerPublic, Member } from "@ujima/shared";
import { Select } from "@/components/ui/select";
import { settingsFetch, settingsFetchVoid } from "@/features/settings/shared/settings-api";
import { useSettingsPage } from "@/features/settings/shared/settings-workspace-context";
import { SettingsErrorAlert } from "@/features/settings/shared/settings-alert";
import {
  SettingsBadge,
  SettingsGhostIconButton,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from "@/features/settings/shared/settings-buttons";
import { SettingsEmptyState } from "@/features/settings/shared/settings-empty-state";
import { SettingsList, SettingsListRow, SettingsRowIcon } from "@/features/settings/shared/settings-list-row";
import { SettingsTabActions } from "@/features/settings/shared/settings-layout";
import { SettingsSection } from "@/features/settings/shared/settings-section";
import { McpAttachModal } from "./mcps/mcp-attach-modal";
import { serverLabel } from "./mcps/mcp-form-types";
import { McpImportModal } from "./mcps/mcp-import-modal";
import { McpServerFormModal } from "./mcps/mcp-server-form-modal";
import { GovernanceDefaultsPanel } from "./mcps/governance-defaults-panel";
import { ToolsSubtab } from "./mcps/tools-subtab";
import { AgentsSubtab } from "./mcps/agents-subtab";
import { useMcpCatalog } from "./mcps/use-mcp-catalog";

type Subtab = "tools" | "servers" | "agents" | "defaults";

const SUBTABS: { key: Subtab; label: string }[] = [
  { key: "tools", label: "Tools" },
  { key: "servers", label: "Servers" },
  { key: "agents", label: "Agents" },
  { key: "defaults", label: "Defaults" },
];

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "error") return "warning" as const;
  return "default" as const;
}

export const McpsTab = memo(function McpsTab({
  orgId,
  createdBy,
  members,
}: {
  orgId: string;
  createdBy: string;
  members: Member[];
}) {
  const { mcpServers: servers, setMcpServers } = useSettingsPage();
  const agents = useMemo(
    () => members.filter((m) => m.kind === "agent" && !m.retiredAt),
    [members],
  );
  const catalog = useMcpCatalog(orgId); // Wait, let's verify if useMcpCatalog or useMcpMcpCatalog is used. Ah! The original has useMcpCatalog(orgId) at line 58. Let's make sure it is useMcpCatalog(orgId).
  // Yes: const catalog = useMcpCatalog(orgId);
  // Let's keep it as catalog = useMcpCatalog(orgId);
  const [subtab, setSubtab] = useState<Subtab>("tools");
  const [error, setError] = useState<string | null>(null);

  // Servers-subtab local state — kept inline so the existing lifecycle
  // ops (test/delete/edit/import/attach/detach) work unchanged.
  const [formServer, setFormServer] = useState<McpServerPublic | null | "new">(null);
  const [showImport, setShowImport] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [toolCounts, setToolCounts] = useState<Record<string, number>>({});
  const [toolsByServer, setToolsByServer] = useState<Record<string, TestMcpResponse["tools"]>>({});
  const [expandedToolsId, setExpandedToolsId] = useState<string | null>(null);
  const [attachAgentId, setAttachAgentId] = useState("");
  const activeAgentId = attachAgentId || agents[0]?.id || "";
  const [attachments, setAttachments] = useState<AgentMcpAttachment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadToolCount = useCallback(
    async (serverId: string) => {
      try {
        const data = await settingsFetch<McpToolsResponse>(
          `/api/settings/mcps/${encodeURIComponent(serverId)}/tools?organizationId=${encodeURIComponent(orgId)}`,
          undefined,
          "Failed to load tools.",
        );
        setToolCounts((prev) => ({ ...prev, [serverId]: data.tools.length }));
        setToolsByServer((prev) => ({ ...prev, [serverId]: data.tools }));
      } catch {}
    },
    [orgId],
  );

  const refreshServers = useCallback(async () => {
    const data = await settingsFetch<McpServerListResponse>(
      `/api/settings/mcps?organizationId=${encodeURIComponent(orgId)}`,
      undefined,
      "Failed to refresh MCP servers.",
    );
    setMcpServers(data.servers);
    await Promise.all(
      data.servers.filter((s) => s.lastTestedAt).map((s) => loadToolCount(s.id)),
    );
  }, [orgId, setMcpServers, loadToolCount]);

  const loadAttachments = useCallback(
    async (agentId: string) => {
      if (!agentId) {
        setAttachments([]);
        return;
      }
      const data = await settingsFetch<AgentMcpAttachmentsResponse>(
        `/api/settings/agents/${encodeURIComponent(agentId)}/mcps?organizationId=${encodeURIComponent(orgId)}`,
        undefined,
        "Failed to load attachments.",
      );
      setAttachments(data.attachments);
    },
    [orgId],
  );

  useEffect(() => {
    if (!orgId || !activeAgentId) return;
    let ignore = false;
    queueMicrotask(() => {
      void loadAttachments(activeAgentId).catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : "Failed to load attachments.");
      });
    });
    return () => {
      ignore = true;
    };
  }, [orgId, activeAgentId, loadAttachments]);

  // Backfill tool-counts for previously tested servers on first mount.
  useEffect(() => {
    let ignore = false;
    queueMicrotask(() => {
      if (ignore) return;
      for (const s of servers) {
        if (s.lastTestedAt && toolCounts[s.id] == null) {
          void loadToolCount(s.id);
        }
      }
    });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers]);

  const deleteServer = useCallback(async (serverId: string) => {
    setError(null);
    setBusy(`delete:${serverId}`);
    try {
      await settingsFetchVoid(
        `/api/settings/mcps/${encodeURIComponent(serverId)}?organizationId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
        "Failed to delete MCP server.",
      );
      setMcpServers(servers.filter((s) => s.id !== serverId));
      if (activeAgentId) await loadAttachments(activeAgentId);
      await catalog.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete MCP server.");
    } finally {
      setBusy(null);
    }
  }, [orgId, servers, setMcpServers, activeAgentId, loadAttachments, catalog]);

  const testServer = useCallback(async (serverId: string) => {
    setError(null);
    setBusy(`test:${serverId}`);
    try {
      const result = await settingsFetch<TestMcpResponse>(
        `/api/settings/mcps/${encodeURIComponent(serverId)}/test?organizationId=${encodeURIComponent(orgId)}`,
        { method: "POST" },
        "MCP test failed.",
      );
      if (!result.ok) throw new Error(result.error ?? "MCP test failed.");
      setToolCounts((prev) => ({ ...prev, [serverId]: result.tools.length }));
      setToolsByServer((prev) => ({ ...prev, [serverId]: result.tools }));
      setExpandedToolsId(serverId);
      setRecoveryNotice(
        result.recovery
          ? `Test succeeded after retrying with an isolated npm cache at ${result.recovery.cacheDir}. Your host npm cache looks corrupted — run \`npm cache verify\` (or \`npm cache clean --force\`) on this machine to clear it.`
          : null,
      );
      await refreshServers();
      await catalog.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "MCP test failed.");
    } finally {
      setBusy(null);
    }
  }, [orgId, refreshServers, catalog]);

  const detachServer = useCallback(async (mcpServerId: string) => {
    if (!activeAgentId) return;
    setBusy(`detach:${mcpServerId}`);
    try {
      await settingsFetchVoid(
        `/api/settings/agents/${encodeURIComponent(activeAgentId)}/mcps/${encodeURIComponent(mcpServerId)}?organizationId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
        "Failed to detach MCP server.",
      );
      await loadAttachments(activeAgentId);
      await catalog.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to detach.");
    } finally {
      setBusy(null);
    }
  }, [activeAgentId, orgId, loadAttachments, catalog]);

  return (
    <>
      {subtab === "servers" ? (
        <SettingsTabActions>
          <SettingsSecondaryButton onClick={() => setShowImport(true)}>
            <Upload className="h-3.5 w-3.5" />
            Import
          </SettingsSecondaryButton>
          <SettingsPrimaryButton onClick={() => setFormServer("new")}>
            <Plus className="h-4 w-4" />
            Add
          </SettingsPrimaryButton>
        </SettingsTabActions>
      ) : null}

      {error || catalog.error ? (
        <SettingsErrorAlert message={error ?? catalog.error ?? ""} />
      ) : null}
      {recoveryNotice ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">{recoveryNotice}</p>
      ) : null}
      {importResult ? (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">{importResult}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {SUBTABS.map(({ key, label }) => {
          const active = subtab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSubtab(key)}
              className={`relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                active
                  ? "border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300"
                  : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {subtab === "tools" ? (
        <SettingsSection
          title="Tools"
          description="Every MCP tool across all servers, filterable by class, server, or agent. Click any row to assign it to agents."
        >
          <ToolsSubtab orgId={orgId} agents={agents} catalog={catalog} />
        </SettingsSection>
      ) : null}

      {subtab === "agents" ? (
        <SettingsSection
          title="Agents"
          description="What tools each agent can actually call. Grant individual tools to keep the prompt palette small."
        >
          <AgentsSubtab orgId={orgId} agents={agents} catalog={catalog} />
        </SettingsSection>
      ) : null}

      {subtab === "defaults" ? (
        <SettingsSection
          title="Org-wide defaults"
          description="What happens by default when a tool of each risk class is called and no explicit rule matches."
        >
          <GovernanceDefaultsPanel
            value={catalog.riskDefaults}
            onSave={catalog.saveRiskDefaults}
          />
        </SettingsSection>
      ) : null}

      {subtab === "servers" ? (
        <>
          <SettingsSection
            title="MCP servers"
            description="Add or import Model Context Protocol servers for your organization."
          >
            {servers.length === 0 ? (
              <SettingsEmptyState
                icon={Plug}
                title="No MCP servers"
                description="Add or import servers to get started."
                action={
                  <SettingsPrimaryButton onClick={() => setFormServer("new")}>
                    <Plus className="h-4 w-4" />
                    Add server
                  </SettingsPrimaryButton>
                }
              />
            ) : (
              <SettingsList>
                {servers.map((server) => {
                  const tools = toolsByServer[server.id];
                  const expanded = expandedToolsId === server.id;
                  return (
                    <div key={server.id} className="space-y-1">
                      <SettingsListRow
                        leading={<SettingsRowIcon icon={Plug} />}
                        primary={server.name}
                        secondary={
                          <span className="flex flex-wrap items-center gap-1.5">
                            <SettingsBadge variant={statusVariant(server.status)}>{server.status}</SettingsBadge>
                            <SettingsBadge>{server.transport}</SettingsBadge>
                            <span>
                              {toolCounts[server.id] != null
                                ? `${toolCounts[server.id]} tools`
                                : "Not tested"}
                            </span>
                          </span>
                        }
                        actions={
                          <>
                            {tools?.length ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedToolsId(expanded ? null : server.id)
                                }
                                className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-100 dark:hover:bg-zinc-900"
                                title="Toggle tools"
                              >
                                {expanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            ) : null}
                            <SettingsSecondaryButton onClick={() => setFormServer(server)}>
                              Edit
                            </SettingsSecondaryButton>
                            <SettingsSecondaryButton
                              disabled={busy === `test:${server.id}`}
                              onClick={() => void testServer(server.id)}
                            >
                              {busy === `test:${server.id}` ? "…" : "Test"}
                            </SettingsSecondaryButton>
                            <SettingsGhostIconButton
                              title="Delete server"
                              disabled={busy === `delete:${server.id}`}
                              onClick={() => void deleteServer(server.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </SettingsGhostIconButton>
                          </>
                        }
                      />
                      {expanded && tools?.length ? (
                        <ul className="ml-4 space-y-1 border-l border-zinc-200 py-1 pl-4 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">
                          {tools.map((tool) => (
                            <li key={tool.name}>
                              <span className="font-medium">{tool.name}</span>
                              {tool.description ? ` — ${tool.description}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </SettingsList>
            )}
          </SettingsSection>

          <SettingsSection
            title="Agent attachments"
            description="Coarse-grained: attach a whole MCP server to an agent. For finer control use the Tools or Agents tab."
            className="border-t border-zinc-200 pt-8 dark:border-zinc-800"
            actions={
              activeAgentId && servers.length > 0 ? (
                <SettingsPrimaryButton onClick={() => setShowAttach(true)}>
                  <Plus className="h-4 w-4" />
                  Attach
                </SettingsPrimaryButton>
              ) : null
            }
          >
            {agents.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No agents yet.</p>
            ) : (
              <>
                <div className="mb-4 max-w-xs">
                  <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Agent</label>
                  <div className="mt-2">
                    <Select
                      value={activeAgentId}
                      onChange={(e) => setAttachAgentId(e.target.value)}
                      options={agents.map((a) => ({ value: a.id, label: a.name }))}
                    />
                  </div>
                </div>

                {attachments.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">No servers attached.</p>
                ) : (
                  <SettingsList>
                    {attachments.map((attachment) => {
                      const server = servers.find((s) => s.id === attachment.mcpServerId);
                      return (
                        <SettingsListRow
                          key={attachment.id}
                          primary={server ? serverLabel(server) : attachment.mcpServerId}
                          secondary={attachment.scope}
                          actions={
                            <SettingsSecondaryButton
                              disabled={busy === `detach:${attachment.mcpServerId}`}
                              onClick={() => void detachServer(attachment.mcpServerId)}
                            >
                              Detach
                            </SettingsSecondaryButton>
                          }
                        />
                      );
                    })}
                  </SettingsList>
                )}
              </>
            )}
          </SettingsSection>
        </>
      ) : null}

      <McpServerFormModal
        isOpen={formServer !== null}
        onClose={() => setFormServer(null)}
        editingServer={formServer === "new" || formServer === null ? null : formServer}
        orgId={orgId}
        createdBy={createdBy}
        onSave={(server) => {
          if (formServer === "new") {
            setMcpServers([...servers, server]);
          } else {
            setMcpServers(servers.map((s) => (s.id === server.id ? server : s)));
          }
          void catalog.refresh();
        }}
      />

      <McpImportModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        orgId={orgId}
        createdBy={createdBy}
        onImported={(msg) => {
          setImportResult(msg);
          void refreshServers().catch((err) =>
            setError(err instanceof Error ? err.message : "Refresh failed."),
          );
          void catalog.refresh();
        }}
      />

      {activeAgentId ? (
        <McpAttachModal
          isOpen={showAttach}
          onClose={() => setShowAttach(false)}
          orgId={orgId}
          agentId={activeAgentId}
          servers={servers}
          onAttached={() => {
            void loadAttachments(activeAgentId);
            void catalog.refresh();
          }}
        />
      ) : null}
    </>
  );
});
