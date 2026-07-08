import * as vscode from 'vscode';
import { buildBacklogView, type BacklogNode } from './backlog';
import type { JoyClient } from './joyClient';
import type {
  JoyItem,
  JoyItemType,
  JoyListResponse,
  JoyMilestone,
  JoyMilestoneListResponse,
} from './types';

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
  private items: JoyItem[] = [];

  constructor(private readonly client: JoyClient) {}

  refresh(): void {
    this.cachedRoots = undefined;
    this.pendingLoad = undefined;
    this.emitter.fire();
  }

  currentItems(): readonly JoyItem[] {
    return this.items;
  }

  getTreeItem(node: BacklogNode): vscode.TreeItem {
    if (node.kind === 'milestone') {
      return milestoneTreeItem(node.milestone, node.children.length > 0);
    }
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
      command: 'joy.openDetail',
      title: 'Open Item Detail',
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
    const [list, milestones] = await Promise.all([
      this.client.runJson<JoyListResponse>(['ls', '--all']),
      this.loadMilestones(),
    ]);
    this.items = list.data.items;
    return buildBacklogView(list.data.items, milestones);
  }

  private async loadMilestones(): Promise<JoyMilestone[]> {
    try {
      const response = await this.client.runJson<JoyMilestoneListResponse>(['milestone', 'ls']);
      return response.data.milestones;
    } catch {
      return [];
    }
  }
}

function milestoneTreeItem(milestone: JoyMilestone, hasChildren: boolean): vscode.TreeItem {
  const treeItem = new vscode.TreeItem(
    milestone.title,
    hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
  );
  treeItem.id = milestone.id;
  const progress =
    milestone.total !== undefined ? ` · ${milestone.closed ?? 0}/${milestone.total}` : '';
  const date = milestone.date ? ` · ${milestone.date}` : '';
  treeItem.description = `${milestone.id}${progress}${date}`;
  treeItem.iconPath = new vscode.ThemeIcon('milestone');
  treeItem.contextValue = 'milestone';
  return treeItem;
}

function buildTooltip(item: JoyItem): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${item.id}** — ${item.title}\n\n`);
  md.appendMarkdown(`- Type: ${item.type}\n`);
  md.appendMarkdown(`- Status: ${item.status}\n`);
  md.appendMarkdown(`- Priority: ${item.priority}\n`);
  if (item.effort !== undefined && item.effort !== null) {
    md.appendMarkdown(`- Effort: ${item.effort}\n`);
  }
  if (item.parent) {
    md.appendMarkdown(`- Parent: ${item.parent}\n`);
  }
  if (item.milestone) {
    md.appendMarkdown(`- Milestone: ${item.milestone}\n`);
  }
  if (item.deps && item.deps.length > 0) {
    md.appendMarkdown(`- Depends on: ${item.deps.join(', ')}\n`);
  }
  if (item.description) {
    md.appendMarkdown(`\n${item.description}`);
  }
  return md;
}
