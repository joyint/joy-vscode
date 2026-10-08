/**
 * Whether a member key is an AI member's (joy's rule): an AI member is
 * known by its name (`claude`), a person by an address, or in an
 * anonymous project by an `m-` id.
 */
export function isAiMember(id: string): boolean {
  return id !== '' && !id.includes('@') && !id.startsWith('m-');
}

/** The AI members among a project's member keys, sorted. */
export function aiMembers(keys: readonly string[]): string[] {
  return keys.filter(isAiMember).sort();
}
