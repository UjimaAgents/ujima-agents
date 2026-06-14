import type { WorkspaceCreateSubmitInput } from "../settings/organization/components/workspaces/workspace-create-modal";

export interface CreatedWorkspace {
  id: string;
  root_path: string | null;
  label: string | null;
  created_at: number;
  updated_at: number;
  is_current?: boolean;
}

export async function createWorkspaceApi(
  input: WorkspaceCreateSubmitInput,
): Promise<CreatedWorkspace> {
  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      input.sourceWorkspaceId && input.copyOptions
        ? {
            source_workspace_id: input.sourceWorkspaceId,
            root_path: input.rootPath,
            label: input.name,
            copy_options: {
              provider_keys: input.copyOptions.providerKeys,
              provider_configs: input.copyOptions.providerConfigs,
              agents: input.copyOptions.agents,
              roles: input.copyOptions.roles,
              channels: input.copyOptions.channels,
              tools: input.copyOptions.tools,
              policies: input.copyOptions.policies,
              org_chart: input.copyOptions.orgChart,
            },
          }
        : {
            root_path: input.rootPath,
            label: input.name,
            copy_providers: input.copyProviders,
          },
    ),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || "Failed to create workspace");
  }

  return res.json() as Promise<CreatedWorkspace>;
}
