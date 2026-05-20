"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentMcpAttachmentsResponse,
  CreateMcpServerRequest,
  ImportMcpServersResponse,
  McpServerListResponse,
  McpServerResponse,
  McpToolsResponse,
  TestMcpResponse,
  UpdateMcpServerRequest,
} from "@ujima/api-schema";
import type {
  AgentMcpAttachment,
  McpAttachmentScope,
  McpServerPublic,
  McpServerStatus,
  McpTransport,
  Member,
} from "@ujima/shared";
import { FieldShell, TextArea, TextInput } from "@/components/ui/form-fields";
import { Select } from "@/components/ui/select";
import {
  formatArgsInput,
  formatSecretKeysHint,
  parseArgsInput,
  parseSecretMapInput,
} from "./mcps-form-helpers";

type ServerFormState = {
  name: string;
  description: string;
  category: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  envText: string;
  headersText: string;
  isolation: "shared" | "per-agent";
  status: McpServerStatus;
  clearEnv: boolean;
  clearHeaders: boolean;
  envTouched: boolean;
  headersTouched: boolean;
};

const TRANSPORT_OPTIONS: { value: McpTransport; label: string }[] = [
  { value: "stdio", label: "stdio" },
  { value: "sse", label: "sse" },
  { value: "http-streamable", label: "http-streamable" },
];

const SCOPE_OPTIONS: { value: McpAttachmentScope; label: string }[] = [
  { value: "worker", label: "worker" },
  { value: "supervisor", label: "supervisor" },
  { value: "both", label: "both" },
];

function emptyForm(): ServerFormState {
  return {
    name: "",
    description: "",
    category: "general",
    transport: "stdio",
    command: "",
    argsText: "",
    url: "",
    envText: "",
    headersText: "",
    isolation: "shared",
    status: "active",
    clearEnv: false,
    clearHeaders: false,
    envTouched: false,
    headersTouched: false,
  };
}

function formFromServer(server: McpServerPublic): ServerFormState {
  return {
    name: server.name,
    description: server.description,
    category: server.category,
    transport: server.transport,
    command: server.command ?? "",
    argsText: formatArgsInput(server.args),
    url: server.url ?? "",
    envText: "",
    headersText: "",
    isolation: server.isolation,
    status: server.status,
    clearEnv: false,
    clearHeaders: false,
    envTouched: false,
    headersTouched: false,
  };
}

function serverLabel(server: McpServerPublic): string {
  return `${server.name} (${server.transport})`;
}

export function McpsTab({
  orgId,
  createdBy,
  servers: initialServers,
  members,
  onServersChange,
}: {
  orgId: string;
  createdBy: string;
  servers: McpServerPublic[];
  members: Member[];
  onServersChange: (servers: McpServerPublic[]) => void;
}) {
  const agents = useMemo(() => members.filter((member) => member.kind === "agent"), [members]);

  const [servers, setServers] = useState(initialServers);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState<ServerFormState>(emptyForm);
  const [importJson, setImportJson] = useState("");
  const [toolCounts, setToolCounts] = useState<Record<string, number>>({});
  const [toolsByServer, setToolsByServer] = useState<Record<string, TestMcpResponse["tools"]>>({});
  const [expandedToolsId, setExpandedToolsId] = useState<string | null>(null);

  const [attachAgentId, setAttachAgentId] = useState("");
  const activeAgentId = attachAgentId || agents[0]?.id || "";
  const [attachServerId, setAttachServerId] = useState("");
  const [attachScope, setAttachScope] = useState<McpAttachmentScope>("worker");
  const [attachments, setAttachments] = useState<AgentMcpAttachment[]>([]);
  const [attachmentsAgentId, setAttachmentsAgentId] = useState("");

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const updateServers = useCallback(
    (next: McpServerPublic[]) => {
      setServers(next);
      onServersChange(next);
    },
    [onServersChange],
  );

  const loadToolCount = useCallback(
    async (serverId: string) => {
      const response = await fetch(
        `/api/settings/mcps/${encodeURIComponent(serverId)}/tools?organizationId=${encodeURIComponent(orgId)}`,
      );
      if (!response.ok) return;
      const data = (await response.json()) as McpToolsResponse;
      setToolCounts((prev) => ({ ...prev, [serverId]: data.tools.length }));
      setToolsByServer((prev) => ({ ...prev, [serverId]: data.tools }));
    },
    [orgId],
  );

  const refreshServers = useCallback(async () => {
    const response = await fetch(`/api/settings/mcps?organizationId=${encodeURIComponent(orgId)}`);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message ?? "Failed to refresh MCP servers.");
    }
    const data = (await response.json()) as McpServerListResponse;
    updateServers(data.servers);
    await Promise.all(
      data.servers.filter((server) => server.lastTestedAt).map((server) => loadToolCount(server.id)),
    );
    return data.servers;
  }, [orgId, updateServers, loadToolCount]);

  const loadAttachments = useCallback(
    async (agentId: string) => {
      if (!agentId) {
        setAttachments([]);
        setAttachmentsAgentId("");
        return;
      }
      const response = await fetch(
        `/api/settings/agents/${encodeURIComponent(agentId)}/mcps?organizationId=${encodeURIComponent(orgId)}`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to load attachments.");
      }
      const data = (await response.json()) as AgentMcpAttachmentsResponse;
      setAttachments(data.attachments);
      setAttachmentsAgentId(agentId);
    },
    [orgId],
  );

  const handleAgentChange = (agentId: string) => {
    setAttachAgentId(agentId);
    setAttachments([]);
    setAttachmentsAgentId(agentId);
  };

  useEffect(() => {
    if (!orgId || !activeAgentId) return;
    let ignore = false;
    const fetchAttachments = async () => {
      try {
        const response = await fetch(
          `/api/settings/agents/${encodeURIComponent(activeAgentId)}/mcps?organizationId=${encodeURIComponent(orgId)}`,
        );
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message ?? "Failed to load attachments.");
        }
        const data = (await response.json()) as AgentMcpAttachmentsResponse;
        if (!ignore) {
          setAttachments(data.attachments);
          setAttachmentsAgentId(activeAgentId);
        }
      } catch (err) {
        if (!ignore) setError(err instanceof Error ? err.message : "Failed to load attachments.");
      }
    };
    void fetchAttachments();
    return () => {
      ignore = true;
    };
  }, [orgId, activeAgentId]);

  const displayedAttachments = activeAgentId && attachmentsAgentId === activeAgentId ? attachments : [];

  const startEdit = (server: McpServerPublic) => {
    setShowNewForm(false);
    setEditingId(server.id);
    setForm(formFromServer(server));
    setError(null);
  };

  const startNew = () => {
    setEditingId(null);
    setShowNewForm(true);
    setForm(emptyForm());
    setError(null);
  };

  const cancelForm = () => {
    setEditingId(null);
    setShowNewForm(false);
    setForm(emptyForm());
  };

  const buildCreatePayload = (): CreateMcpServerRequest | null => {
    if (!form.name.trim()) {
      setError("Server name is required.");
      return null;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      setError("stdio servers require a command.");
      return null;
    }
    if (form.transport !== "stdio" && !form.url.trim()) {
      setError(`${form.transport} servers require a URL.`);
      return null;
    }
    if (!createdBy) {
      setError("Session member is required to create MCP servers.");
      return null;
    }

    const payload: CreateMcpServerRequest = {
      organizationId: orgId,
      createdBy,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      category: form.category.trim() || undefined,
      transport: form.transport,
      isolation: form.isolation,
    };

    if (form.transport === "stdio") {
      payload.command = form.command.trim();
      const args = parseArgsInput(form.argsText);
      if (args.length) payload.args = args;
      const env = parseSecretMapInput(form.envText);
      if (env) payload.env = env;
    } else {
      payload.url = form.url.trim();
      const headers = parseSecretMapInput(form.headersText);
      if (headers) payload.headers = headers;
    }

    return payload;
  };

  const buildUpdatePayload = (): UpdateMcpServerRequest | null => {
    if (!form.name.trim()) {
      setError("Server name is required.");
      return null;
    }
    if (form.transport === "stdio" && !form.command.trim()) {
      setError("stdio servers require a command.");
      return null;
    }
    if (form.transport !== "stdio" && !form.url.trim()) {
      setError(`${form.transport} servers require a URL.`);
      return null;
    }

    const payload: UpdateMcpServerRequest = {
      organizationId: orgId,
      name: form.name.trim(),
      description: form.description.trim(),
      category: form.category.trim() || undefined,
      isolation: form.isolation,
    };

    if (form.status === "active" || form.status === "disabled") {
      payload.status = form.status;
    }

    if (form.transport === "stdio") {
      payload.command = form.command.trim();
      payload.args = parseArgsInput(form.argsText);
      if (form.clearEnv) payload.env = null;
      else if (form.envTouched) payload.env = parseSecretMapInput(form.envText);
    } else {
      payload.url = form.url.trim();
      if (form.clearHeaders) payload.headers = null;
      else if (form.headersTouched) payload.headers = parseSecretMapInput(form.headersText);
    }

    return payload;
  };

  const saveServer = async () => {
    if (!orgId) return;
    setError(null);
    setBusy("save");

    try {
      if (editingId) {
        const payload = buildUpdatePayload();
        if (!payload) return;
        const response = await fetch(`/api/settings/mcps/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message ?? "Failed to update MCP server.");
        }
        const data = (await response.json()) as McpServerResponse;
        updateServers(servers.map((server) => (server.id === editingId ? data.server : server)));
        cancelForm();
      } else {
        const payload = buildCreatePayload();
        if (!payload) return;
        const response = await fetch("/api/settings/mcps", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message ?? "Failed to create MCP server.");
        }
        const data = (await response.json()) as McpServerResponse;
        updateServers([...servers, data.server]);
        cancelForm();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save MCP server.");
    } finally {
      setBusy(null);
    }
  };

  const deleteServer = async (serverId: string) => {
    if (!orgId) return;
    setError(null);
    setBusy(`delete:${serverId}`);
    try {
      const response = await fetch(
        `/api/settings/mcps/${encodeURIComponent(serverId)}?organizationId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 204) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to delete MCP server.");
      }
      updateServers(servers.filter((server) => server.id !== serverId));
      setAttachServerId((selectedId) => (selectedId === serverId ? "" : selectedId));
      if (activeAgentId) await loadAttachments(activeAgentId);
      if (editingId === serverId) cancelForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete MCP server.");
    } finally {
      setBusy(null);
    }
  };

  const testServer = async (serverId: string) => {
    if (!orgId) return;
    setError(null);
    setBusy(`test:${serverId}`);
    try {
      const response = await fetch(
        `/api/settings/mcps/${encodeURIComponent(serverId)}/test?organizationId=${encodeURIComponent(orgId)}`,
        { method: "POST" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "MCP test failed.");
      }
      const result = (await response.json()) as TestMcpResponse;
      if (!result.ok) {
        throw new Error(result.error ?? "MCP test failed.");
      }
      setToolCounts((prev) => ({ ...prev, [serverId]: result.tools.length }));
      setToolsByServer((prev) => ({ ...prev, [serverId]: result.tools }));
      setExpandedToolsId(serverId);
      await refreshServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "MCP test failed.");
    } finally {
      setBusy(null);
    }
  };

  const importServers = async () => {
    if (!orgId || !importJson.trim()) return;
    if (!createdBy) {
      setError("Session member is required to import MCP servers.");
      return;
    }
    setError(null);
    setImportResult(null);
    setBusy("import");
    try {
      const response = await fetch("/api/settings/mcps/import", {
        method: "POST",
        body: JSON.stringify({
          organizationId: orgId,
          createdBy,
          json: importJson,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Import failed.");
      }
      const data = (await response.json()) as ImportMcpServersResponse;
      const refreshed = await refreshServers();
      const importedIds = new Set(data.imported.map((server) => server.id));
      const merged = refreshed.filter((server) => importedIds.has(server.id));
      for (const server of merged) {
        if (server.lastTestedAt) void loadToolCount(server.id);
      }
      const parts = [`Imported ${data.imported.length} server(s).`];
      if (data.warnings.length) parts.push(`Warnings: ${data.warnings.join("; ")}`);
      if (data.skipped.length) {
        parts.push(
          `Skipped: ${data.skipped.map((entry) => `${entry.name} (${entry.reason})`).join(", ")}`,
        );
      }
      setImportResult(parts.join(" "));
      setImportJson("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  const attachServer = async () => {
    if (!orgId || !activeAgentId || !attachServerId) return;
    setError(null);
    setBusy("attach");
    try {
      const response = await fetch(
        `/api/settings/agents/${encodeURIComponent(activeAgentId)}/mcps`,
        {
          method: "POST",
          body: JSON.stringify({
            organizationId: orgId,
            mcpServerId: attachServerId,
            scope: attachScope,
          }),
        },
      );
      if (!response.ok && response.status !== 204) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to attach MCP server.");
      }
      await loadAttachments(activeAgentId);
      setAttachServerId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to attach MCP server.");
    } finally {
      setBusy(null);
    }
  };

  const detachServer = async (mcpServerId: string) => {
    if (!orgId || !activeAgentId) return;
    setError(null);
    setBusy(`detach:${mcpServerId}`);
    try {
      const response = await fetch(
        `/api/settings/agents/${encodeURIComponent(activeAgentId)}/mcps/${encodeURIComponent(mcpServerId)}?organizationId=${encodeURIComponent(orgId)}`,
        { method: "DELETE" },
      );
      if (!response.ok && response.status !== 204) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Failed to detach MCP server.");
      }
      await loadAttachments(activeAgentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to detach MCP server.");
    } finally {
      setBusy(null);
    }
  };

  const editingServer = editingId ? servers.find((server) => server.id === editingId) : null;
  const showForm = showNewForm || editingId !== null;

  const renderSecretFields = (mode: "create" | "edit", server?: McpServerPublic) => {
    if (form.transport === "stdio") {
      return (
        <FieldShell
          label="Environment variables"
          htmlFor="mcp-env"
          hint="One KEY=value per line. Leave blank to keep existing values when editing."
        >
          <TextArea
            id="mcp-env"
            rows={3}
            value={form.envText}
            placeholder={
              mode === "edit" && server?.hasEnv
                ? formatSecretKeysHint(server.envKeys) || "KEY=value"
                : "KEY=value"
            }
            onChange={(event) =>
              setForm((prev) => ({ ...prev, envText: event.target.value, envTouched: true, clearEnv: false }))
            }
          />
          {mode === "edit" && server?.hasEnv ? (
            <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={form.clearEnv}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    clearEnv: event.target.checked,
                    envTouched: event.target.checked ? false : prev.envTouched,
                  }))
                }
              />
              Clear stored environment variables
            </label>
          ) : null}
        </FieldShell>
      );
    }

    return (
      <FieldShell
        label="Headers"
        htmlFor="mcp-headers"
        hint="One KEY=value per line. Leave blank to keep existing values when editing."
      >
        <TextArea
          id="mcp-headers"
          rows={3}
          value={form.headersText}
          placeholder={
            mode === "edit" && server?.hasHeaders
              ? formatSecretKeysHint(server.headerKeys) || "Authorization=Bearer …"
              : "Authorization=Bearer …"
          }
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              headersText: event.target.value,
              headersTouched: true,
              clearHeaders: false,
            }))
          }
        />
        {mode === "edit" && server?.hasHeaders ? (
          <label className="mt-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={form.clearHeaders}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  clearHeaders: event.target.checked,
                  headersTouched: event.target.checked ? false : prev.headersTouched,
                }))
              }
            />
            Clear stored headers
          </label>
        ) : null}
      </FieldShell>
    );
  };

  const renderForm = () => (
    <div className="space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-end gap-3">
        <FieldShell label="Name" htmlFor="mcp-name">
          <TextInput
            id="mcp-name"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
        </FieldShell>
        <FieldShell label="Category" htmlFor="mcp-category">
          <TextInput
            id="mcp-category"
            value={form.category}
            onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
          />
        </FieldShell>
        <div className="min-w-[160px]">
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Transport</label>
          <div className="mt-3">
            <Select
              value={form.transport}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  transport: event.target.value as McpTransport,
                }))
              }
              options={TRANSPORT_OPTIONS}
              className={editingId ? "pointer-events-none opacity-60" : undefined}
            />
          </div>
        </div>
      </div>

      <FieldShell label="Description" htmlFor="mcp-description">
        <TextArea
          id="mcp-description"
          rows={2}
          value={form.description}
          onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
        />
      </FieldShell>

      {form.transport === "stdio" ? (
        <>
          <FieldShell label="Command" htmlFor="mcp-command">
            <TextInput
              id="mcp-command"
              value={form.command}
              onChange={(event) => setForm((prev) => ({ ...prev, command: event.target.value }))}
            />
          </FieldShell>
          <FieldShell label="Args" htmlFor="mcp-args" hint="Newline- or comma-separated.">
            <TextArea
              id="mcp-args"
              rows={2}
              value={form.argsText}
              onChange={(event) => setForm((prev) => ({ ...prev, argsText: event.target.value }))}
            />
          </FieldShell>
        </>
      ) : (
        <FieldShell label="URL" htmlFor="mcp-url">
          <TextInput
            id="mcp-url"
            value={form.url}
            onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))}
          />
        </FieldShell>
      )}

      {renderSecretFields(editingId ? "edit" : "create", editingServer ?? undefined)}

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[140px]">
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Isolation</label>
          <div className="mt-3">
            <Select
              value={form.isolation}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  isolation: event.target.value as "shared" | "per-agent",
                }))
              }
              options={[
                { value: "shared", label: "shared" },
                { value: "per-agent", label: "per-agent" },
              ]}
            />
          </div>
        </div>
        {editingId ? (
          <div className="min-w-[140px]">
            <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Status</label>
            <div className="mt-3">
              <Select
                value={form.status}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    status: event.target.value as McpServerStatus,
                  }))
                }
                options={[
                  { value: "active", label: "active" },
                  { value: "disabled", label: "disabled" },
                  ...(form.status === "error" ? [{ value: "error", label: "error" }] : []),
                ]}
              />
            </div>
          </div>
        ) : null}
        <button
          type="button"
          disabled={busy === "save"}
          onClick={() => void saveServer()}
          className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : editingId ? "Save changes" : "Add server"}
        </button>
        <button
          type="button"
          onClick={cancelForm}
          className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Register MCP servers for your organization. Secret values are stored by the daemon and never shown again.
          </p>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700"
          >
            <Plus className="h-4 w-4" />
            Add server
          </button>
        </div>

        {servers.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No MCP servers registered yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {servers.map((server) => {
              const toolCount = toolCounts[server.id];
              const tools = toolsByServer[server.id];
              const secrets =
                server.transport === "stdio"
                  ? server.hasEnv
                    ? `env: ${server.envKeys.join(", ") || "configured"}`
                    : "env: none"
                  : server.hasHeaders
                    ? `headers: ${server.headerKeys.join(", ") || "configured"}`
                    : "headers: none";

              return (
                <li key={server.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{server.name}</p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {server.status} · {server.transport} · {server.category} · {server.isolation} · {secrets} ·
                        tools: {toolCount ?? "—"}
                      </p>
                      {server.lastTestedAt ? (
                        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                          Last test {new Date(server.lastTestedAt).toLocaleString()}
                          {server.lastTestError ? ` — ${server.lastTestError}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(server)}
                        className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy === `test:${server.id}`}
                        onClick={() => void testServer(server.id)}
                        className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        {busy === `test:${server.id}` ? "Testing…" : "Test"}
                      </button>
                      <button
                        type="button"
                        disabled={busy === `delete:${server.id}`}
                        onClick={() => void deleteServer(server.id)}
                        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {expandedToolsId === server.id && tools?.length ? (
                    <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-300">
                      {tools.map((tool) => (
                        <li key={tool.name}>
                          <span className="font-medium">{tool.name}</span>
                          {tool.description ? ` — ${tool.description}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {showForm ? renderForm() : null}
      </section>

      <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Import from JSON</h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Paste a Claude Desktop config, a <code className="text-xs">servers</code> object, or a bare keyed map.
        </p>
        <TextArea
          rows={6}
          value={importJson}
          onChange={(event) => setImportJson(event.target.value)}
          placeholder='{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] } } }'
        />
        <button
          type="button"
          disabled={busy === "import" || !importJson.trim()}
          onClick={() => void importServers()}
          className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
        >
          {busy === "import" ? "Importing…" : "Import servers"}
        </button>
        {importResult ? <p className="text-sm text-emerald-600 dark:text-emerald-400">{importResult}</p> : null}
      </section>

      <section className="space-y-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Agent attachments</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Attach MCP servers to agents with worker, supervisor, or both scope.
            </p>
          </div>
          {activeAgentId ? (
            <button
              type="button"
              disabled={busy === "load-attachments"}
              onClick={() => {
                setBusy("load-attachments");
                void loadAttachments(activeAgentId)
                  .catch((err) => {
                    setError(err instanceof Error ? err.message : "Failed to load attachments.");
                  })
                  .finally(() => setBusy(null));
              }}
              className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              {busy === "load-attachments" ? "Loading…" : "Refresh"}
            </button>
          ) : null}
        </div>

        {agents.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No agents in this organization yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px]">
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Agent</label>
                <div className="mt-3">
                  <Select
                    value={activeAgentId}
                    onChange={(event) => {
                      handleAgentChange(event.target.value);
                    }}
                    options={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
                  />
                </div>
              </div>
              <div className="min-w-[200px]">
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">MCP server</label>
                <div className="mt-3">
                  <Select
                    value={attachServerId}
                    onChange={(event) => setAttachServerId(event.target.value)}
                    placeholder="Select server"
                    options={servers.map((server) => ({
                      value: server.id,
                      label: serverLabel(server),
                    }))}
                  />
                </div>
              </div>
              <div className="min-w-[140px]">
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Scope</label>
                <div className="mt-3">
                  <Select
                    value={attachScope}
                    onChange={(event) => setAttachScope(event.target.value as McpAttachmentScope)}
                    options={SCOPE_OPTIONS}
                  />
                </div>
              </div>
              <button
                type="button"
                disabled={busy === "attach" || !attachServerId}
                onClick={() => void attachServer()}
                className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                {busy === "attach" ? "Attaching…" : "Attach"}
              </button>
            </div>

            {displayedAttachments.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No MCP servers attached to this agent.</p>
            ) : (
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {displayedAttachments.map((attachment) => {
                  const server = servers.find((entry) => entry.id === attachment.mcpServerId);
                  return (
                    <li key={attachment.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-sm text-zinc-800 dark:text-zinc-200">
                        {server ? serverLabel(server) : attachment.mcpServerId} · {attachment.scope}
                      </span>
                      <button
                        type="button"
                        disabled={busy === `detach:${attachment.mcpServerId}`}
                        onClick={() => void detachServer(attachment.mcpServerId)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        Detach
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
