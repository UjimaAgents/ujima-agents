"use client";

import { useState } from "react";
import type { CreateMcpServerRequest, UpdateMcpServerRequest } from "@ujima/api-schema";
import type { McpServerPublic, McpServerStatus, McpTransport } from "@ujima/shared";
import { Modal } from "@/components/ui/modal";
import { FieldShell, TextArea, TextInput } from "@/components/ui/form-fields";
import { Select } from "@/components/ui/select";
import { settingsFetch } from "@/features/settings/shared/settings-api";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";
import {
  formatSecretKeysHint,
  parseArgsInput,
  parseSecretMapInput,
} from "../mcps-form-helpers";
import {
  emptyForm,
  formFromServer,
  TRANSPORT_OPTIONS,
  type ServerFormState,
} from "./mcp-form-types";

export function McpServerFormModal(props: {
  isOpen: boolean;
  onClose: () => void;
  editingServer: McpServerPublic | null;
  orgId: string;
  createdBy: string;
  onSave: (server: McpServerPublic) => void;
}) {
  if (!props.isOpen) return null;
  return <McpServerFormModalActive {...props} />;
}

function McpServerFormModalActive({
  onClose,
  editingServer,
  orgId,
  createdBy,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  editingServer: McpServerPublic | null;
  orgId: string;
  createdBy: string;
  onSave: (server: McpServerPublic) => void;
}) {
  const [form, setForm] = useState<ServerFormState>(
    () => (editingServer ? formFromServer(editingServer) : emptyForm()),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleSave = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      if (editingServer) {
        const payload = buildUpdatePayload();
        if (!payload) return;
        const data = await settingsFetch<{ server: McpServerPublic }>(
          `/api/settings/mcps/${encodeURIComponent(editingServer.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          "Failed to update MCP server.",
        );
        onSave(data.server);
        onClose();
      } else {
        const payload = buildCreatePayload();
        if (!payload) return;
        const data = await settingsFetch<{ server: McpServerPublic }>(
          "/api/settings/mcps",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          "Failed to create MCP server.",
        );
        onSave(data.server);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save MCP server.");
    } finally {
      setBusy(false);
    }
  };

  const renderSecretFields = () => {
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
              editingServer?.hasEnv
                ? formatSecretKeysHint(editingServer.envKeys) || "KEY=value"
                : "KEY=value"
            }
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                envText: event.target.value,
                envTouched: true,
                clearEnv: false,
              }))
            }
          />
          {editingServer?.hasEnv ? (
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
            editingServer?.hasHeaders
              ? formatSecretKeysHint(editingServer.headerKeys) || "Authorization=Bearer …"
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
        {editingServer?.hasHeaders ? (
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

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editingServer ? "Edit MCP server" : "Add MCP server"}
      contentClassName="max-w-lg"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldShell label="Name" htmlFor="mcp-name">
            <TextInput
              id="mcp-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </FieldShell>
          <FieldShell label="Category" htmlFor="mcp-category">
            <TextInput
              id="mcp-category"
              value={form.category}
              onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
            />
          </FieldShell>
        </div>

        <FieldShell label="Transport" htmlFor="mcp-transport">
          <Select
            id="mcp-transport"
            value={form.transport}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                transport: e.target.value as McpTransport,
              }))
            }
            options={TRANSPORT_OPTIONS}
            className={editingServer ? "pointer-events-none opacity-60" : undefined}
          />
        </FieldShell>

        <FieldShell label="Description" htmlFor="mcp-description">
          <TextArea
            id="mcp-description"
            rows={2}
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
          />
        </FieldShell>

        {form.transport === "stdio" ? (
          <>
            <FieldShell label="Command" htmlFor="mcp-command">
              <TextInput
                id="mcp-command"
                value={form.command}
                onChange={(e) => setForm((prev) => ({ ...prev, command: e.target.value }))}
              />
            </FieldShell>
            <FieldShell label="Args" htmlFor="mcp-args" hint="Newline- or comma-separated.">
              <TextArea
                id="mcp-args"
                rows={2}
                value={form.argsText}
                onChange={(e) => setForm((prev) => ({ ...prev, argsText: e.target.value }))}
              />
            </FieldShell>
          </>
        ) : (
          <FieldShell label="URL" htmlFor="mcp-url">
            <TextInput
              id="mcp-url"
              value={form.url}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
            />
          </FieldShell>
        )}

        {renderSecretFields()}

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldShell label="Isolation" htmlFor="mcp-isolation">
            <Select
              id="mcp-isolation"
              value={form.isolation}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  isolation: e.target.value as "shared" | "per-agent",
                }))
              }
              options={[
                { value: "shared", label: "shared" },
                { value: "per-agent", label: "per-agent" },
              ]}
            />
          </FieldShell>
          {editingServer ? (
            <FieldShell label="Status" htmlFor="mcp-status">
              <Select
                id="mcp-status"
                value={form.status}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    status: e.target.value as McpServerStatus,
                  }))
                }
                options={[
                  { value: "active", label: "active" },
                  { value: "disabled", label: "disabled" },
                  ...(form.status === "error" ? [{ value: "error", label: "error" }] : []),
                ]}
              />
            </FieldShell>
          ) : null}
        </div>

        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <SettingsPrimaryButton disabled={busy} onClick={() => void handleSave()}>
            {busy ? "Saving…" : editingServer ? "Save" : "Add server"}
          </SettingsPrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
