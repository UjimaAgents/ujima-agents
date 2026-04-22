import * as vscode from 'vscode';
import { AgentDef, TeamDef } from '@ujima/shared';

interface TeamFile {
  fileName: string;
  uri: vscode.Uri;
  def: TeamDef;
}

export async function createTeamCommand(channel: vscode.OutputChannel): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Ujima: open a workspace folder first.');
    return;
  }

  const agents = await loadAgents(folder.uri, channel);
  if (agents.length === 0) {
    void vscode.window.showErrorMessage(
      'Ujima: no agents in .ujima/agents/. Run "Ujima: Onboard New Agent" first.',
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    agents.map((a) => ({
      label: a.name,
      description: a.id,
      detail: `mcp=${a.mcp} · ${a.seniority ?? 'junior'}`,
      value: a.id,
      picked: true,
    })),
    {
      canPickMany: true,
      title: 'Ujima — Create team · pick members',
      placeHolder: `${agents.length} agents available. Tick the ones in this team.`,
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    },
  );
  if (!picked || picked.length === 0) return;
  const memberIds = picked.map((p) => p.value);

  const displayName = await vscode.window.showInputBox({
    title: 'Ujima — Create team · name',
    prompt: 'Human-readable team name (e.g. "Profile Card Build")',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length > 0 ? null : 'Name is required.'),
  });
  if (!displayName) return;

  const defaultId = slug(displayName);
  const teamId = await vscode.window.showInputBox({
    title: 'Ujima — Create team · id',
    prompt: 'Team id (letters, digits, hyphens / underscores)',
    value: defaultId,
    validateInput: (v) => (/^[a-zA-Z0-9_-]+$/.test(v) ? null : 'Use letters/digits/_/- only.'),
    ignoreFocusOut: true,
  });
  if (!teamId) return;

  const team: TeamDef = TeamDef.parse({
    team_id: teamId,
    name: displayName.trim(),
    agents: memberIds,
  });

  const targetDir = vscode.Uri.joinPath(folder.uri, '.ujima', 'teams');
  const targetFile = vscode.Uri.joinPath(targetDir, `${teamId}.json`);

  try {
    await vscode.workspace.fs.stat(targetFile);
    const overwrite = await vscode.window.showWarningMessage(
      `${teamId}.json already exists. Overwrite?`,
      { modal: true },
      'Overwrite',
    );
    if (overwrite !== 'Overwrite') return;
  } catch {
    /* not found — good */
  }

  await vscode.workspace.fs.createDirectory(targetDir);
  await vscode.workspace.fs.writeFile(targetFile, new TextEncoder().encode(JSON.stringify(team, null, 2)));

  channel.appendLine(`[team] saved ${targetFile.fsPath} (${memberIds.length} agents)`);
  const openIt = await vscode.window.showInformationMessage(
    `Ujima: saved team "${teamId}" (${displayName}) with ${memberIds.length} agents.`,
    'Open file',
  );
  if (openIt === 'Open file') {
    const doc = await vscode.workspace.openTextDocument(targetFile);
    await vscode.window.showTextDocument(doc);
  }
}

export async function manageTeamsCommand(channel: vscode.OutputChannel): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showErrorMessage('Ujima: open a workspace folder first.');
    return;
  }

  const teams = await loadTeams(folder.uri, channel);
  if (teams.length === 0) {
    void vscode.window.showInformationMessage(
      'Ujima: no teams in .ujima/teams/. Run "Ujima: Create Team" to add one.',
    );
    return;
  }

  const pick = await vscode.window.showQuickPick(
    teams.map((t) => ({
      label: t.def.name,
      description: t.def.team_id,
      detail: `${t.def.agents.length} agents · ${t.def.agents.join(', ')}`,
      team: t,
    })),
    { title: 'Ujima — Manage teams', placeHolder: 'Pick a team', ignoreFocusOut: true },
  );
  if (!pick) return;

  const action = await vscode.window.showQuickPick(
    [
      { label: '$(file-code) Open JSON', value: 'open' },
      { label: '$(edit) Edit members', value: 'edit' },
      { label: '$(trash) Delete team', value: 'delete' },
    ],
    { title: `Ujima — ${pick.team.def.team_id}`, ignoreFocusOut: true },
  );
  if (!action) return;

  if (action.value === 'open') {
    const doc = await vscode.workspace.openTextDocument(pick.team.uri);
    await vscode.window.showTextDocument(doc);
    return;
  }

  if (action.value === 'delete') {
    const confirm = await vscode.window.showWarningMessage(
      `Delete team "${pick.team.def.team_id}"? This removes .ujima/teams/${pick.team.fileName}. Agent files stay intact.`,
      { modal: true },
      'Delete',
    );
    if (confirm !== 'Delete') return;
    await vscode.workspace.fs.delete(pick.team.uri, { useTrash: true });
    channel.appendLine(`[team] deleted ${pick.team.uri.fsPath}`);
    void vscode.window.showInformationMessage(`Ujima: team "${pick.team.def.team_id}" deleted.`);
    return;
  }

  if (action.value === 'edit') {
    const agents = await loadAgents(folder.uri, channel);
    const currentSet = new Set(pick.team.def.agents);
    const picked = await vscode.window.showQuickPick(
      agents.map((a) => ({
        label: a.name,
        description: a.id,
        detail: `mcp=${a.mcp}`,
        value: a.id,
        picked: currentSet.has(a.id),
      })),
      {
        canPickMany: true,
        title: `Ujima — Edit members of "${pick.team.def.team_id}"`,
        ignoreFocusOut: true,
      },
    );
    if (!picked) return;
    const next: TeamDef = { ...pick.team.def, agents: picked.map((p) => p.value) };
    await vscode.workspace.fs.writeFile(pick.team.uri, new TextEncoder().encode(JSON.stringify(next, null, 2)));
    channel.appendLine(`[team] updated ${pick.team.uri.fsPath} → ${next.agents.length} agents`);
    void vscode.window.showInformationMessage(
      `Ujima: team "${next.team_id}" now has ${next.agents.length} members.`,
    );
  }
}

async function loadAgents(
  workspace: vscode.Uri,
  channel: vscode.OutputChannel,
): Promise<AgentDef[]> {
  const dir = vscode.Uri.joinPath(workspace, '.ujima', 'agents');
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return [];
  }
  const out: AgentDef[] = [];
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
    try {
      const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name));
      const parsed = AgentDef.safeParse(JSON.parse(new TextDecoder().decode(raw)));
      if (parsed.success) out.push(parsed.data);
      else channel.appendLine(`[teams] skipped agent ${name}: ${parsed.error.issues[0]?.message}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      channel.appendLine(`[teams] could not read ${name}: ${msg}`);
    }
  }
  return out;
}

async function loadTeams(
  workspace: vscode.Uri,
  channel: vscode.OutputChannel,
): Promise<TeamFile[]> {
  const dir = vscode.Uri.joinPath(workspace, '.ujima', 'teams');
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    return [];
  }
  const out: TeamFile[] = [];
  for (const [name, type] of entries) {
    if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
    const uri = vscode.Uri.joinPath(dir, name);
    try {
      const raw = await vscode.workspace.fs.readFile(uri);
      const parsed = TeamDef.safeParse(JSON.parse(new TextDecoder().decode(raw)));
      if (parsed.success) out.push({ fileName: name, uri, def: parsed.data });
      else channel.appendLine(`[teams] skipped team ${name}: ${parsed.error.issues[0]?.message}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      channel.appendLine(`[teams] could not read team ${name}: ${msg}`);
    }
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'team';
}