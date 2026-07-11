import * as assert from 'node:assert/strict';
import { findJoyIdMatches } from '../../joyLinks';
import type { JoyItem } from '../../types';

function item(id: string): JoyItem {
  return { id, title: id, type: 'task', status: 'new', priority: 'medium' };
}

describe('findJoyIdMatches', () => {
  const items = [item('JVSC-0023-5C'), item('JOY-01FF-36'), item('A3-007B-B2')];

  it('links a full id present in the backlog', () => {
    const text = 'see JVSC-0023-5C for details';
    const matches = findJoyIdMatches(text, items);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.id, 'JVSC-0023-5C');
    assert.equal(text.slice(matches[0]!.start, matches[0]!.end), 'JVSC-0023-5C');
  });

  it('resolves a short reference to the full id', () => {
    const text = 'fixed in JVSC-0023 today';
    const matches = findJoyIdMatches(text, items);
    assert.equal(matches.length, 1);
    assert.equal(matches[0]!.id, 'JVSC-0023-5C');
    assert.equal(text.slice(matches[0]!.start, matches[0]!.end), 'JVSC-0023');
  });

  it('matches acronyms with digits (A3)', () => {
    const matches = findJoyIdMatches('board item A3-007B-B2 here', items);
    assert.deepEqual(
      matches.map((m) => m.id),
      ['A3-007B-B2'],
    );
  });

  it('ignores ids that are not in the backlog', () => {
    assert.deepEqual(findJoyIdMatches('unknown ABCD-9999-ZZ here', items), []);
    assert.deepEqual(findJoyIdMatches('XX-1234 nope', items), []);
  });

  it('finds several ids with correct offsets', () => {
    const text = 'JVSC-0023-5C and JOY-01FF-36';
    const matches = findJoyIdMatches(text, items);
    assert.deepEqual(
      matches.map((m) => m.id),
      ['JVSC-0023-5C', 'JOY-01FF-36'],
    );
    assert.equal(text.slice(matches[1]!.start, matches[1]!.end), 'JOY-01FF-36');
  });

  it('returns nothing when the backlog is empty', () => {
    assert.deepEqual(findJoyIdMatches('JVSC-0023-5C', []), []);
  });
});
