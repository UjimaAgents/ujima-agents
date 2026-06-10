"use client";

import { useState } from "react";
import type { ImportMcpServersResponse } from "@ujima/api-schema";
import { Modal } from "@/components/ui/modal";
import { TextArea } from "@/components/ui/form-fields";
import { settingsFetch } from "@/features/settings/shared/settings-api";
import { SettingsPrimaryButton } from "@/features/settings/shared/settings-buttons";

export function McpImportModal({
  isOpen,
  onClose,
  orgId,
  createdBy,
  onImported,
  prefillJson,
}: {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  createdBy: string;
  onImported: (message: string) => void;
  prefillJson?: string;
}) {
  const [importJson, setImportJson] = useState(prefillJson ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setImportJson("");
    setError(null);
    onClose();
  };

  const importServers = async () => {
    if (!orgId || !importJson.trim()) return;
    if (!createdBy) {
      setError("Session member is required to import MCP servers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await settingsFetch<ImportMcpServersResponse>(
        "/api/settings/mcps/import",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: orgId,
            createdBy,
            json: importJson,
          }),
        },
        "Import failed.",
      );
      const parts = [`Imported ${data.imported.length} server(s).`];
      if (data.warnings.length) parts.push(`Warnings: ${data.warnings.join("; ")}`);
      if (data.skipped.length) {
        parts.push(
          `Skipped: ${data.skipped.map((entry) => `${entry.name} (${entry.reason})`).join(", ")}`,
        );
      }
      onImported(parts.join(" "));
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import MCP servers" contentClassName="max-w-lg">
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Paste a Claude Desktop config, a servers object, or a keyed map.
      </p>
      <TextArea
        rows={8}
        value={importJson}
        onChange={(e) => setImportJson(e.target.value)}
        placeholder='{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"] } } }'
      />
      {error ? <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={handleClose}
          className="rounded-xl px-4 py-2 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          Cancel
        </button>
        <SettingsPrimaryButton disabled={busy || !importJson.trim()} onClick={() => void importServers()}>
          {busy ? "Importing…" : "Import"}
        </SettingsPrimaryButton>
      </div>
    </Modal>
  );
}
