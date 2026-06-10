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
  const isDuplicate = !!input.sourceWorkspaceId && !!input.copyOptions;

  const res = await fetch("/api/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      isDuplicate
        ? {
            source_workspace_id: input.sourceWorkspaceId,
            root_path: input.rootPath,
            label: input.name,
            copy_options: input.copyOptions,
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
