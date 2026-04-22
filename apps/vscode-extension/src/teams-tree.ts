import * as vscode from 'vscode';
import { TeamDef } from '@ujima/shared';

type TeamNode = TeamRow | MemberRow | Placeholder;
interface TeamRow {
  kind: 'team';
  team: TeamDef;
  fileUri: vscode.Uri;
}
interface MemberRow {
  kind: 'member';
  teamId: string;
  agentId: string;
}
interface Placeholder {
  kind: 'placeholder';
  label: string;
}

export class TeamsTreeProvider implements vscode.TreeDataProvider<TeamNode>, vscode.Disposable {
  private readonly didChange = new vscode.EventEmitter<TeamNode | undefined>();
  readonly onDidChangeTreeData = this.didChange.event;
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly channel: vscode.OutputChannel;

  constructor(channel: vscode.OutputChannel) {
    this.channel = channel;
    this.watcher = vscode.workspace.createFileSystemWatcher('**/.ujima/teams/*.json');
    this.watcher.onDidChange(() => this.refresh());
    this.watcher.onDidCreate(() => this.refresh());
    this.watcher.onDidDelete(() => this.refresh());
  }

  refresh(): void {
    this.didChange.fire(undefined);
  }

  dispose(): void {
    this.watcher.dispose();
    this.didChange.dispose();
  }

  getTreeItem(node: TeamNode): vscode.TreeItem {
    if (node.kind === 'placeholder') {
      const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      i.iconPath = new vscode.ThemeIcon('info');
      i.contextValue = 'ujima.placeholder';
      return i;
    }
    if (node.kind === 'team') {
      const i = new vscode.TreeItem(node.team.name, vscode.TreeItemCollapsibleState.Expanded);
      i.id = `team:${node.team.team_id}`;
      i.description = `${node.team.agents.length} members`;
      i.tooltip = new vscode.MarkdownString(
        `**${node.team.name}** (\`${node.team.team_id}\`)\n\n- ${node.team.agents.length} agents\n- File: \`${node.fileUri.fsPath}\``,
      );
      i.iconPath = new vscode.ThemeIcon('organization');
      i.resourceUri = node.fileUri;
      i.command = {
        command: 'vscode.open',
        title: 'Open team JSON',
        arguments: [node.fileUri],
      };
      i.contextValue = 'ujima.team';
      return i;
    }
    const i = new vscode.TreeItem(node.agentId, vscode.TreeItemCollapsibleState.None);
    i.iconPath = new vscode.ThemeIcon('person');
    i.contextValue = 'ujima.teamMember';
    return i;
  }

  async getChildren(element?: TeamNode): Promise<TeamNode[]> {
    if (!element) {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) return [{ kind: 'placeholder', label: 'Open a workspace folder' }];
      const teams = await this.loadTeams(folder.uri);
      if (teams.length === 0) {
        return [{ kind: 'placeholder', label: 'No teams — click "Create Team" above' }];
      }
      return teams;
    }
    if (element.kind === 'team') {
      return element.team.agents.map((agentId) => ({
        kind: 'member',
        teamId: element.team.team_id,
        agentId,
      }));
    }
    return [];
  }

  private async loadTeams(workspace: vscode.Uri): Promise<TeamRow[]> {
    const dir = vscode.Uri.joinPath(workspace, '.ujima', 'teams');
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return [];
    }
    const out: TeamRow[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.json')) continue;
      const uri = vscode.Uri.joinPath(dir, name);
      try {
        const raw = await vscode.workspace.fs.readFile(uri);
        const parsed = TeamDef.safeParse(JSON.parse(new TextDecoder().decode(raw)));
        if (parsed.success) out.push({ kind: 'team', team: parsed.data, fileUri: uri });
        else this.channel.appendLine(`[teams-tree] skipped ${name}: ${parsed.error.issues[0]?.message}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.channel.appendLine(`[teams-tree] read ${name}: ${msg}`);
      }
    }
    out.sort((a, b) => a.team.name.localeCompare(b.team.name));
    return out;
  }
}