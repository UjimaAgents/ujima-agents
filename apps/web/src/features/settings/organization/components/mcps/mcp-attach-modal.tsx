"use client";

import { useState } from "react";
import type { McpAttachmentScope, McpServerPublic } from "@ujima/shared";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { settingsFetchVoid } from "@/features/settings/shared/settings-api";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";
import { serverLabel } from "./mcp-form-types";

const SCOPE_OPTIONS: { value: McpAttachmentScope; label: string }[] = [
  { value: "worker", label: "worker" },
  { value: "supervisor", label: "supervisor" },
  { value: "both", label: "both" },
];

export function McpAttachModal({
  isOpen,
  onClose,
  orgId,
  agentId,
  servers,
  onAttached,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  agentId: string;
  servers: McpServerPublic[];
  onAttached: () => void | Promise<void>;
}) {
  const [serverId, setServerId] = useState("");
  const [scope, setScope] = useState<McpAttachmentScope>("worker");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setServerId("");
    setScope("worker");
    setError(null);
    onClose();
  };

  const attach = async () => {
    if (!orgId || !agentId || !serverId) return;
    setBusy(true);
    setError(null);
    try {
      await settingsFetchVoid(
        `/api/settings/agents/${encodeURIComponent(agentId)}/mcps`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            mcpServerId: serverId,
            scope,
          }),
        },
        "Failed to attach MCP server.",
      );
      await onAttached();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to attach.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Attach MCP server" contentClassName="max-w-md">
      <div className="space-y-4">
        <div>
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">MCP server</label>
          <div className="mt-2">
            <Select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              placeholder="Select server"
              options={servers.map((server) => ({
                value: server.id,
                label: serverLabel(server),
              }))}
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Scope</label>
          <div className="mt-2">
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as McpAttachmentScope)}
              options={SCOPE_OPTIONS}
            />
          </div>
        </div>
        {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <SettingsPrimaryButton disabled={busy || !serverId} onClick={() => void attach()}>
            {busy ? "Attaching…" : "Attach"}
          </SettingsPrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
