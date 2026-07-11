import type { JoyItem, JoyMilestone } from './types';

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

export interface NoMilestoneNode {
  kind: 'no-milestone';
  children: ItemNode[];
}

export type BacklogNode = ItemNode | MilestoneNode | NoMilestoneNode;

/**
 * Chronological ordering for the backlog view. 'old' surfaces the earliest
 * milestone and oldest items first; 'new' reverses it, with freshly created
 * (and yet unassigned) items on top.
 */
export type BacklogOrder = 'old' | 'new';

export function buildBacklogTree(
  items: readonly JoyItem[],
  order: BacklogOrder = 'new',
): ItemNode[] {
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

  sortRecursive(roots, order);
  return roots;
}

/**
 * Full sidebar view: milestone group nodes (each holding the root items linked
 * to it, empty milestones included so they remain drop targets) plus a single
 * "No Milestone" group for the unassigned roots. In 'old' order milestones run
 * earliest-first with the unassigned group last; in 'new' order they run
 * latest-first with the unassigned group on top. The unassigned group is only
 * materialised when at least one milestone exists and there is something in it;
 * without milestones the plain item tree is returned.
 */
export function buildBacklogView(
  items: readonly JoyItem[],
  milestones: readonly JoyMilestone[],
  order: BacklogOrder = 'new',
): BacklogNode[] {
  const roots = buildBacklogTree(items, order);
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

  milestoneNodes.sort((a, b) => compareMilestones(a, b, order));

  const view: BacklogNode[] = [...milestoneNodes];
  if (unassigned.length > 0) {
    const noMilestone: NoMilestoneNode = { kind: 'no-milestone', children: unassigned };
    if (order === 'new') {
      view.unshift(noMilestone);
    } else {
      view.push(noMilestone);
    }
  }
  return view;
}

export type DropAction =
  | { kind: 'reparent'; id: string; parent: string }
  | { kind: 'clearParent'; id: string }
  | { kind: 'link'; id: string; milestone: string }
  | { kind: 'unlink'; id: string };

/**
 * Decide what a drop means. Dropping on an item re-parents, dropping on a
 * milestone links, dropping on the "No Milestone" group unlinks the milestone,
 * dropping on the empty view area clears the parent. No-op moves (onto self,
 * onto the current parent, onto a descendant, onto the already-linked
 * milestone, unlinking an already-unassigned item) are rejected.
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
    } else if (target.kind === 'no-milestone') {
      if (item.milestone) {
        actions.push({ kind: 'unlink', id });
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

function compareMilestones(a: MilestoneNode, b: MilestoneNode, order: BacklogOrder): number {
  const aDate = a.milestone.date ?? '';
  const bDate = b.milestone.date ?? '';
  // Undated milestones always trail the dated ones, in both orderings.
  if (!aDate && !bDate) {
    return a.milestone.id.localeCompare(b.milestone.id);
  }
  if (!aDate) return 1;
  if (!bDate) return -1;
  const delta = aDate.localeCompare(bDate);
  return order === 'old' ? delta : -delta;
}

function sortRecursive(nodes: ItemNode[], order: BacklogOrder): void {
  nodes.sort((a, b) => compareItems(a.item, b.item, order));
  for (const node of nodes) {
    if (node.children.length > 0) {
      sortRecursive(node.children, order);
    }
  }
}

function compareItems(a: JoyItem, b: JoyItem, order: BacklogOrder): number {
  const aKey = a.created ?? '';
  const bKey = b.created ?? '';
  let delta = aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  if (delta === 0) {
    delta = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  return order === 'old' ? delta : -delta;
}
