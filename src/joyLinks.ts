import type { JoyItem } from './types';

export interface JoyIdMatch {
  start: number;
  end: number;
  /** The resolved full item id (short references resolve to their full id). */
  id: string;
}

/** ACRONYM-XXXX with an optional -YY checksum segment. */
export const JOY_ID_PATTERN = '\\b[A-Z][A-Z0-9]+-[0-9A-F]{4}(?:-[0-9A-F]{2})?\\b';

/** Strip the trailing checksum segment: ACRONYM-XXXX-YY -> ACRONYM-XXXX. */
function shortForm(id: string): string {
  const parts = id.split('-');
  return parts.length >= 3 ? parts.slice(0, 2).join('-') : id;
}

/**
 * Find Joy item ids in `text` that resolve to a known item. Both full ids
 * (JVSC-0023-5C) and short references (JVSC-0023) are matched and resolved to
 * the full id; tokens that do not correspond to a loaded item are skipped so we
 * never render a dead link.
 */
export function findJoyIdMatches(text: string, items: readonly JoyItem[]): JoyIdMatch[] {
  if (items.length === 0) return [];
  const full = new Set<string>();
  const short = new Map<string, string>();
  for (const item of items) {
    full.add(item.id);
    short.set(shortForm(item.id), item.id);
  }

  const re = new RegExp(JOY_ID_PATTERN, 'g');
  const matches: JoyIdMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    const id = full.has(token) ? token : short.get(token);
    if (!id) continue;
    matches.push({ start: m.index, end: m.index + token.length, id });
  }
  return matches;
}
