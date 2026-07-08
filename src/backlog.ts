import type { JoyItem, JoyItemPriority, JoyItemStatus, JoyMilestone } from './types';

export interface ItemNode {
  kind: 'item';
  item: JoyItem;
  children: ItemNode[];
}

export interface MilestoneNode {
  kind: 'milestone';
  milestone: JoyMilestone;
  children: ItemNode[];
}

export type BacklogNode = ItemNode | MilestoneNode;

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

export function buildBacklogTree(items: readonly JoyItem[]): ItemNode[] {
  const byId = new Map<string, ItemNode>();
  for (const item of items) {
    byId.set(item.id, { kind: 'item', item, children: [] });
  }

  const roots: ItemNode[] = [];
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

/**
 * Full sidebar view: milestone group nodes first (each holding the root items
 * linked to it, empty milestones included so they remain drop targets), then
 * the root items without a milestone.
 */
export function buildBacklogView(
  items: readonly JoyItem[],
  milestones: readonly JoyMilestone[],
): BacklogNode[] {
  const roots = buildBacklogTree(items);
  if (milestones.length === 0) {
    return roots;
  }

  const milestoneNodes: MilestoneNode[] = milestones.map((milestone) => ({
    kind: 'milestone',
    milestone,
    children: [],
  }));
  const byMilestoneId = new Map(milestoneNodes.map((node) => [node.milestone.id, node]));

  const unassigned: ItemNode[] = [];
  for (const root of roots) {
    const group = root.item.milestone ? byMilestoneId.get(root.item.milestone) : undefined;
    if (group) {
      group.children.push(root);
    } else {
      unassigned.push(root);
    }
  }

  milestoneNodes.sort(compareMilestones);
  return [...milestoneNodes, ...unassigned];
}

export type DropAction =
  | { kind: 'reparent'; id: string; parent: string }
  | { kind: 'clearParent'; id: string }
  | { kind: 'link'; id: string; milestone: string };

/**
 * Decide what a drop means. Dropping on an item re-parents, dropping on a
 * milestone links, dropping on the empty view area clears the parent. No-op
 * moves (onto self, onto the current parent, onto a descendant, onto the
 * already-linked milestone) are rejected.
 */
export function planDrop(
  draggedIds: readonly string[],
  target: BacklogNode | undefined,
  items: readonly JoyItem[],
): DropAction[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const actions: DropAction[] = [];
  for (const id of draggedIds) {
    const item = byId.get(id);
    if (!item) continue;
    if (!target) {
      if (item.parent) {
        actions.push({ kind: 'clearParent', id });
      }
    } else if (target.kind === 'milestone') {
      if (item.milestone !== target.milestone.id) {
        actions.push({ kind: 'link', id, milestone: target.milestone.id });
      }
    } else {
      const parentId = target.item.id;
      if (parentId !== id && item.parent !== parentId && !isAncestor(id, parentId, byId)) {
        actions.push({ kind: 'reparent', id, parent: parentId });
      }
    }
  }
  return actions;
}

function isAncestor(
  candidateAncestorId: string,
  startId: string,
  byId: ReadonlyMap<string, JoyItem>,
): boolean {
  const seen = new Set<string>();
  let current = byId.get(startId)?.parent;
  while (current && !seen.has(current)) {
    if (current === candidateAncestorId) return true;
    seen.add(current);
    current = byId.get(current)?.parent;
  }
  return false;
}

function compareMilestones(a: MilestoneNode, b: MilestoneNode): number {
  const aDate = a.milestone.date ?? '';
  const bDate = b.milestone.date ?? '';
  if (aDate !== bDate) {
    if (!aDate) return 1;
    if (!bDate) return -1;
    return aDate.localeCompare(bDate);
  }
  return a.milestone.id.localeCompare(b.milestone.id);
}

function sortRecursive(nodes: ItemNode[]): void {
  nodes.sort(compareNodes);
  for (const node of nodes) {
    if (node.children.length > 0) {
      sortRecursive(node.children);
    }
  }
}

function compareNodes(a: ItemNode, b: ItemNode): number {
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
