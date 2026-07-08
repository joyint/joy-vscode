import type { JoyItemStatus } from './types';

/** Governed lifecycle verbs offered per current status, mirroring the app. */
export const STATUS_VERBS: Record<JoyItemStatus, readonly string[]> = {
  new: ['approve', 'start', 'defer'],
  open: ['start', 'defer'],
  'in-progress': ['submit', 'close', 'defer'],
  review: ['close', 'rework', 'defer'],
  closed: ['reopen'],
  deferred: ['reopen'],
  blocked: [],
};

export const EFFORT_LABELS = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl'] as const;

export function effortLabel(effort: number | null | undefined): string | undefined {
  if (effort === null || effort === undefined) return undefined;
  return EFFORT_LABELS[effort - 1] ?? String(effort);
}

export type DetailEditField =
  | 'title'
  | 'type'
  | 'priority'
  | 'effort'
  | 'milestone'
  | 'description';

const EDIT_FLAGS: Record<DetailEditField, string> = {
  title: '--title',
  type: '--type',
  priority: '--priority',
  effort: '--effort',
  milestone: '--milestone',
  description: '--description',
};

export function buildEditArgs(id: string, field: DetailEditField, value: string): string[] {
  return ['edit', id, EDIT_FLAGS[field], value];
}
