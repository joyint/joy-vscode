import { memberLabel } from './members';

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
  | 'parent'
  | 'description';

const EDIT_FLAGS: Record<DetailEditField, string> = {
  title: '--title',
  type: '--type',
  priority: '--priority',
  effort: '--effort',
  milestone: '--milestone',
  parent: '--parent',
  description: '--description',
};

export function buildEditArgs(id: string, field: DetailEditField, value: string): string[] {
  return ['edit', id, EDIT_FLAGS[field], value];
}

/**
 * The head's line since when and by whom the item exists, as the Joy app
 * shows it: "since 2026-06-30 by claude delegated by horst@example.com".
 */
export function sinceLine(
  created: string | undefined,
  createdBy: string | undefined,
): string | undefined {
  if (!created) return undefined;
  const since = `since ${created.slice(0, 10)}`;
  const by = createdBy?.trim();
  return by ? `${since} by ${memberLabel(by)}` : since;
}
