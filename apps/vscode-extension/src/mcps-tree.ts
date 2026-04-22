import * as vscode from 'vscode';
import { listRegistry, type RegistryEntry } from '@ujima/mcp-client';
import type { MCPDef } from '@ujima/shared';

type McpNode = GroupNode | EntryNode;
interface GroupNode {
  kind: 'group';
  label: string;
  source: 'curated' | 'custom';
}
interface EntryNode {
  kind: 'entry';
  id: string;
  name: string;
  description: string;
  source: 'curated' | 'custom';
  category: string;
}

export class McpsTreeProvider implements vscode.TreeDataProvider<McpNode>, vscode.Disposable {
  private readonly didChange = new vscode.EventEmitter<McpNode | undefined>();
  readonly onDidChangeTreeData = this.didChange.event;
  private readonly sub: vscode.Disposable;

  constructor() {
    this.sub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ujima.mcp.custom')) this.refresh();
    });
  }

  refresh(): void {
    this.didChange.fire(undefined);
  }

  dispose(): void {
    this.sub.dispose();
    this.didChange.dispose();
  }

  getTreeItem(node: McpNode): vscode.TreeItem {
    if (node.kind === 'group') {
      const i = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      i.iconPath = new vscode.ThemeIcon(node.source === 'curated' ? 'library' : 'plug');
      i.contextValue = `ujima.mcpGroup.${node.source}`;
      return i;
    }
    const i = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    i.id = `mcp:${node.source}:${node.id}`;
    i.description = node.id;
    i.tooltip = new vscode.MarkdownString(
      `**${node.name}** (\`${node.id}\`)\n\n${node.description}\n\n*${node.category} · ${node.source}*`,
    );
    i.iconPath = new vscode.ThemeIcon(iconFor(node.category));
    i.contextValue = `ujima.mcp.${node.source}`;
    return i;
  }

  getChildren(element?: McpNode): McpNode[] {
    if (!element) {
      return [
        { kind: 'group', label: 'Curated', source: 'curated' },
        { kind: 'group', label: 'Custom', source: 'custom' },
      ];
    }
    if (element.kind !== 'group') return [];
    if (element.source === 'curated') {
      return listRegistry().map<EntryNode>((e: RegistryEntry) => ({
        kind: 'entry',
        id: e.id,
        name: e.name,
        description: e.description,
        source: 'curated',
        category: e.category,
      }));
    }
    const raw = vscode.workspace.getConfiguration('ujima.mcp').get<unknown[]>('custom') ?? [];
    const out: EntryNode[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const def = item as Partial<MCPDef>;
      if (typeof def.id !== 'string' || !def.id) continue;
      out.push({
        kind: 'entry',
        id: def.id,
        name: def.name ?? def.id,
        description: def.description ?? `Custom MCP (${def.transport ?? 'stdio'})`,
        source: 'custom',
        category: def.category ?? 'custom',
      });
    }
    if (out.length === 0) return [];
    return out;
  }
}

function iconFor(category: string): string {
  switch (category) {
    case 'design':
      return 'symbol-color';
    case 'browser':
      return 'browser';
    case 'database':
      return 'database';
    case 'filesystem':
      return 'file-directory';
    default:
      return 'plug';
  }
}