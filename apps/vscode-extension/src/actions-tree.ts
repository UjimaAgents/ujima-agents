import * as vscode from 'vscode';

interface ActionItem {
  label: string;
  tooltip: string;
  icon: string;
  command: string;
}

const ACTIONS: ActionItem[] = [
  { label: 'New Task', tooltip: 'Run a task with a team', icon: 'play', command: 'ujima.newTask' },
  { label: 'Onboard Agent', tooltip: 'Create a new agent (MCP → tools → persona)', icon: 'person-add', command: 'ujima.onboardAgent' },
  { label: 'Create Team', tooltip: 'Pick agents to form a team', icon: 'organization', command: 'ujima.createTeam' },
  { label: 'Manage Teams', tooltip: 'Edit or delete existing teams', icon: 'settings-gear', command: 'ujima.manageTeams' },
  { label: 'Add MCP Server', tooltip: 'Paste mcpServers JSON and test the connection', icon: 'plug', command: 'ujima.addMcp' },
  { label: 'MCP Registry', tooltip: 'Browse curated MCP servers', icon: 'library', command: 'ujima.openRegistry' },
  { label: 'Open Agent Chat', tooltip: 'Watch agents think and call tools', icon: 'comment-discussion', command: 'ujima.openAgentChat' },
  { label: 'Open Governance', tooltip: 'Review audit log, token caps, approvals', icon: 'shield', command: 'ujima.openGovernance' },
  { label: 'Open Activity Stream', tooltip: 'Live event feed', icon: 'pulse', command: 'ujima.openActivityStream' },
  { label: 'Load Demo Scenario', tooltip: 'Seed a demo team + MCPs', icon: 'rocket', command: 'ujima.loadDemoScenario' },
  { label: 'Kill Session', tooltip: 'Stop every running agent', icon: 'debug-stop', command: 'ujima.killSession' },
];

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionItem> {
  getTreeItem(a: ActionItem): vscode.TreeItem {
    const item = new vscode.TreeItem(a.label, vscode.TreeItemCollapsibleState.None);
    item.tooltip = a.tooltip;
    item.iconPath = new vscode.ThemeIcon(a.icon);
    item.command = { command: a.command, title: a.label };
    item.contextValue = 'ujima.action';
    return item;
  }
  getChildren(): ActionItem[] {
    return ACTIONS;
  }
}
