export type JoyItemType = 'epic' | 'story' | 'task' | 'bug' | 'rework' | 'decision' | 'idea';

export type JoyItemStatus =
  | 'new'
  | 'open'
  | 'in-progress'
  | 'review'
  | 'closed'
  | 'deferred'
  | 'blocked';

export type JoyItemPriority = 'critical' | 'high' | 'medium' | 'low';

export interface JoyItem {
  id: string;
  title: string;
  type: JoyItemType;
  status: JoyItemStatus;
  priority: JoyItemPriority;
  parent?: string | null;
  milestone?: string | null;
  deps?: string[] | null;
  tags?: string[] | null;
  assignees?: string[] | null;
  effort?: number | null;
  description?: string | null;
  created?: string;
  updated?: string;
}

export interface JoyMilestone {
  id: string;
  title: string;
  date?: string | null;
  total?: number;
  closed?: number;
}

export interface JoyEnvelope<T> {
  version: number;
  data: T;
}

export interface JoyListData {
  items: JoyItem[];
  total: number;
}

export type JoyListResponse = JoyEnvelope<JoyListData>;

export interface JoyMilestoneListData {
  milestones: JoyMilestone[];
  total: number;
}

export type JoyMilestoneListResponse = JoyEnvelope<JoyMilestoneListData>;
