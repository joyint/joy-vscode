import type { JoyItemStatus } from './types';

/** The six workflow statuses, in documented order. */
export const STATUSES: readonly JoyItemStatus[] = [
  'new',
  'open',
  'in-progress',
  'review',
  'closed',
  'deferred',
];

/**
 * CLI invocation moving an item from `current` to `target`, preferring the
 * governed shortcut verbs: approve (new to open), reopen (out of closed or
 * deferred), start, rework (review back to work), submit, close, defer. A
 * move back to new has no verb and sets the status directly. Returns
 * undefined for a no-op or an unknown target.
 */
export function moveArgs(
  id: string,
  current: JoyItemStatus,
  target: JoyItemStatus,
): string[] | undefined {
  if (target === current) return undefined;
  switch (target) {
    case 'new':
      return ['status', id, 'new'];
    case 'open':
      return current === 'closed' || current === 'deferred' ? ['reopen', id] : ['approve', id];
    case 'in-progress':
      return current === 'review' ? ['rework', id] : ['start', id];
    case 'review':
      return ['submit', id];
    case 'closed':
      return ['close', id];
    case 'deferred':
      return ['defer', id];
    default:
      return undefined;
  }
}
