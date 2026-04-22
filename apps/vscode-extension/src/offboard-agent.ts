import * as vscode from 'vscode';
import type { SessionController } from './session-controller';

export async function offboardAgentCommand(
  channel: vscode.OutputChannel,
  controller: SessionController,
  arg: unknown,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Ujima: open a workspace folder first.');
    return;
  }

  let agentId = extractAgentId(arg);
  if (!agentId) {
    const agents = controller.listAgents();
    const onDisk = await listAgentFiles(folder.uri);
    const merged = new Map<string, { id: string; name: string; mcp?: string; status?: string }>();
    for (const a of agents) merged.set(a.id, { id: a.id, name: a.name, mcp: a.mcp, status: a.status });
    for (const id of onDisk) {
      if (!merged.has(id)) merged.set(id, { id, name: id });
    }
    if (merged.size === 0) {
      void vscode.window.showInformationMessage('Ujima: no agents to offboard.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      [...merged.values()].map((a) => ({
        label: a.name,
        description: a.id,
        detail: [a.mcp && `mcp=${a.mcp}`, a.status && `status=${a.status}`].filter(Boolean).join(' · '),
        value: a.id,
      })),
      { title: 'Ujima — Offboard agent', placeHolder: 'Pick an agent to delete', ignoreFocusOut: true },
    );
    agentId = pick?.value;
  }
  if (!agentId) return;

  const file = vscode.Uri.joinPath(folder.uri, '.ujima', 'agents', `${agentId}.json`);
  const confirm = await vscode.window.showWarningMessage(
    `Offboard "${agentId}"? This deletes .ujima/agents/${agentId}.json and removes it from the sidebar.`,
    { modal: true },
    'Offboard',
  );
  if (confirm !== 'Offboard') return;

  let removedFile = false;
  try {
    await vscode.workspace.fs.delete(file, { useTrash: true });
    removedFile = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    channel.appendLine(`[offboard] ${agentId} file delete skipped: ${msg}`);
  }

  controller.removeAgent(agentId);

  const affectedTeams = await updateTeamsRemovingAgent(folder.uri, agentId, channel);

  channel.appendLine(
    `[offboard] ${agentId} — file=${removedFile ? 'deleted' : 'missing'} teams_updated=${affectedTeams.join(',') || '-'}`,
  );
  const msg = affectedTeams.length
    ? `Offboarded ${agentId}. Also removed from team(s): ${affectedTeams.join(', ')}.`
    : `Offboarded ${agentId}.`;
  void vscode.window.showInformationMessage(`Ujima: ${msg}`);
}

async function listAgentFiles(workspace: vscode.Uri): Promise<string[]> {
  const dir = vscode.Uri.joinPath(workspace, '.ujima', 'agents');
  try {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    return entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
      .map(([name]) => name.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

async function updateTeamsRemovingAgent(
  workspace: vscode.Uri,
  agentId: string,
  channel: vscode.OutputChannel,
): Promise<string[]> {
  const dir = vscode.Uri.joinPath(workspace, '.ujima', 'teams');
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return [];
  }
  const affected: string[] = [];
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
    const file = vscode.Uri.joinPath(dir, name);
    try {
      const raw = await vscode.workspace.fs.readFile(file);
      const parsed = JSON.parse(new TextDecoder().decode(raw)) as {
        team_id?: string;
        agents?: unknown;
      };
      if (!Array.isArray(parsed.agents)) continue;
      if (!parsed.agents.includes(agentId)) continue;
      const next = { ...parsed, agents: parsed.agents.filter((id) => id !== agentId) };
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(JSON.stringify(next, null, 2)));
      affected.push(parsed.team_id ?? name.replace(/\.json$/, ''));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      channel.appendLine(`[offboard] could not update team ${name}: ${msg}`);
    }
  }
  return affected;
}

function extractAgentId(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && 'id' in arg && typeof (arg as { id: unknown }).id === 'string') {
    return (arg as { id: string }).id;
  }
  if (arg && typeof arg === 'object' && 'agent' in arg) {
    const agent = (arg as { agent: unknown }).agent;
    if (agent && typeof agent === 'object' && 'id' in agent && typeof (agent as { id: unknown }).id === 'string') {
      return (agent as { id: string }).id;
    }
  }
  return undefined;
}