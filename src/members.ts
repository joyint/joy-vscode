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

/**
 * A member as joy stores it, with a delegation said in words:
 * "claude delegated-by:horst@example.com" reads "claude delegated by
 * horst@example.com".
 */
export function memberLabel(ref: string): string {
  const match = ref.trim().match(/^(\S+)\s+delegated-by:(\S+)$/);
  return match ? `${match[1]} delegated by ${match[2]}` : ref.trim();
}
