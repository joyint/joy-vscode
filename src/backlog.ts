import type { JoyItem, JoyItemPriority, JoyItemStatus } from './types';

export interface BacklogNode {
  item: JoyItem;
  children: BacklogNode[];
}

const STATUS_ORDER: Record<JoyItemStatus, number> = {
  'in-progress': 0,
  review: 1,
  open: 2,
  new: 3,
  blocked: 4,
  deferred: 5,
  closed: 6,
};

const PRIORITY_ORDER: Record<JoyItemPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function buildBacklogTree(items: readonly JoyItem[]): BacklogNode[] {
  const byId = new Map<string, BacklogNode>();
  for (const item of items) {
    byId.set(item.id, { item, children: [] });
  }

  const roots: BacklogNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.item.parent;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  sortRecursive(roots);
  return roots;
}

function sortRecursive(nodes: BacklogNode[]): void {
  nodes.sort(compareNodes);
  for (const node of nodes) {
    if (node.children.length > 0) {
      sortRecursive(node.children);
    }
  }
}

function compareNodes(a: BacklogNode, b: BacklogNode): number {
  const statusDelta = statusRank(a.item.status) - statusRank(b.item.status);
  if (statusDelta !== 0) return statusDelta;
  const priorityDelta = priorityRank(a.item.priority) - priorityRank(b.item.priority);
  if (priorityDelta !== 0) return priorityDelta;
  return a.item.id.localeCompare(b.item.id);
}

function statusRank(status: JoyItemStatus): number {
  return STATUS_ORDER[status] ?? 99;
}

function priorityRank(priority: JoyItemPriority): number {
  return PRIORITY_ORDER[priority] ?? 99;
}
