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
  parent?: string;
  deps?: string[];
  effort?: number;
  description?: string;
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
