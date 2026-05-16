import * as vscode from 'vscode';
import { buildBacklogTree, type BacklogNode } from './backlog';
import type { JoyClient } from './joyClient';
import type { JoyItem, JoyItemType, JoyListResponse } from './types';

const TYPE_ICONS: Record<JoyItemType, string> = {
  epic: 'rocket',
  story: 'book',
  task: 'checklist',
  bug: 'bug',
  rework: 'tools',
  decision: 'law',
  idea: 'lightbulb',
};

export class BacklogProvider implements vscode.TreeDataProvider<BacklogNode> {
  private readonly emitter = new vscode.EventEmitter<BacklogNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private cachedRoots: BacklogNode[] | undefined;
  private pendingLoad: Promise<BacklogNode[]> | undefined;

  constructor(private readonly client: JoyClient) {}

  refresh(): void {
    this.cachedRoots = undefined;
    this.pendingLoad = undefined;
    this.emitter.fire();
  }

  getTreeItem(node: BacklogNode): vscode.TreeItem {
    const item = node.item;
    const treeItem = new vscode.TreeItem(
      item.title,
      node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
    );
    treeItem.id = item.id;
    treeItem.description = `${item.id} · ${item.status} · ${item.priority}`;
    treeItem.tooltip = buildTooltip(item);
    treeItem.iconPath = new vscode.ThemeIcon(TYPE_ICONS[item.type] ?? 'circle-outline');
    treeItem.contextValue = `status:${item.status}`;
    treeItem.command = {
      command: 'joy.show',
      title: 'Show Details',
      arguments: [node],
    };
    return treeItem;
  }

  async getChildren(node?: BacklogNode): Promise<BacklogNode[]> {
    if (node) {
      return node.children;
    }
    if (!this.cachedRoots) {
      if (!this.pendingLoad) {
        this.pendingLoad = this.load();
      }
      try {
        this.cachedRoots = await this.pendingLoad;
      } catch {
        this.cachedRoots = [];
      } finally {
        this.pendingLoad = undefined;
      }
    }
    return this.cachedRoots;
  }

  private async load(): Promise<BacklogNode[]> {
    const response = await this.client.runJson<JoyListResponse>(['ls', '--all']);
    return buildBacklogTree(response.data.items);
  }
}

function buildTooltip(item: JoyItem): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${item.id}** — ${item.title}\n\n`);
  md.appendMarkdown(`- Type: ${item.type}\n`);
  md.appendMarkdown(`- Status: ${item.status}\n`);
  md.appendMarkdown(`- Priority: ${item.priority}\n`);
  if (item.effort !== undefined) {
    md.appendMarkdown(`- Effort: ${item.effort}\n`);
  }
  if (item.parent) {
    md.appendMarkdown(`- Parent: ${item.parent}\n`);
  }
  if (item.deps && item.deps.length > 0) {
    md.appendMarkdown(`- Depends on: ${item.deps.join(', ')}\n`);
  }
  if (item.description) {
    md.appendMarkdown(`\n${item.description}`);
  }
  return md;
}
