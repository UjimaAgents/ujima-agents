import * as vscode from 'vscode';
import type { SessionController, TrackedAgent } from './session-controller';

type TreeNode = McpGroupNode | AgentNode | PlaceholderNode;

interface McpGroupNode {
  kind: 'mcp';
  mcpId: string;
  agents: TrackedAgent[];
}
interface AgentNode {
  kind: 'agent';
  agent: TrackedAgent;
}
interface PlaceholderNode {
  kind: 'placeholder';
  label: string;
}

const STATUS_ICON: Record<TrackedAgent['status'], string> = {
  idle: 'circle-outline',
  active: 'play-circle',
  waiting: 'watch',
  blocked: 'error',
  killed: 'trash',
  exited: 'pass',
};

export class AgentsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly didChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.didChangeTreeData.event;

  constructor(private readonly controller: SessionController) {
    controller.onDidChangeAgents(() => this.didChangeTreeData.fire(undefined));
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === 'placeholder') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'ujima.placeholder';
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }
    if (node.kind === 'mcp') {
      const item = new vscode.TreeItem(
        `${node.mcpId} (${node.agents.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = 'ujima.mcp';
      item.iconPath = new vscode.ThemeIcon('plug');
      return item;
    }
    const a = node.agent;
    const item = new vscode.TreeItem(a.name, vscode.TreeItemCollapsibleState.None);
    item.id = a.id;
    item.description = a.tokenCap
      ? `${tokenBar(a.tokensUsed, a.tokenCap)} ${formatTokens(a.tokensUsed)}/${formatTokens(a.tokenCap)}`
      : a.lastAction ?? a.status;
    item.tooltip = new vscode.MarkdownString(
      `**${a.name}** (\`${a.id}\`)\n\n` +
      `- MCP: \`${a.mcp}\`\n` +
      `- Status: \`${a.status}\`\n` +
      `- Last action: ${a.lastAction ?? '—'}\n` +
      `- Tokens: ${a.tokensUsed.toLocaleString()}${a.tokenCap ? ` / ${a.tokenCap.toLocaleString()}` : ''}\n` +
      (a.tokenCap ? `- Usage: ${Math.round((a.tokensUsed / a.tokenCap) * 100)}%` : ''),
    );
    item.iconPath = new vscode.ThemeIcon(STATUS_ICON[a.status]);
    item.contextValue = 'ujima.agent';
    return item;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      const agents = this.controller.listAgents();
      if (agents.length === 0) {
        return [{ kind: 'placeholder', label: 'No agents yet — run "Ujima: New Task"' }];
      }
      const byMcp = new Map<string, TrackedAgent[]>();
      for (const a of agents) {
        const list = byMcp.get(a.mcp) ?? [];
        list.push(a);
        byMcp.set(a.mcp, list);
      }
      return [...byMcp.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mcpId, group]) => ({ kind: 'mcp', mcpId, agents: group }) as McpGroupNode);
    }
    if (element.kind === 'mcp') {
      return element.agents.map((agent) => ({ kind: 'agent', agent }) as AgentNode);
    }
    return [];
  }
}

function tokenBar(used: number, cap: number): string {
  const WIDTH = 8;
  const filled = cap > 0 ? Math.round((used / cap) * WIDTH) : 0;
  const clamped = Math.min(filled, WIDTH);
  return '█'.repeat(clamped) + '░'.repeat(WIDTH - clamped);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
