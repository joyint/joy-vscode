import * as assert from 'node:assert/strict';
import { buildBacklogTree } from '../../backlog';
import type { JoyItem } from '../../types';

function item(overrides: Partial<JoyItem> & Pick<JoyItem, 'id'>): JoyItem {
  return {
    title: overrides.id,
    type: 'task',
    status: 'new',
    priority: 'medium',
    ...overrides,
  };
}

describe('buildBacklogTree', () => {
  it('nests children under their parent by id', () => {
    const items: JoyItem[] = [
      item({ id: 'X-0001-AA', type: 'epic' }),
      item({ id: 'X-0002-BB', parent: 'X-0001-AA', type: 'story' }),
      item({ id: 'X-0003-CC', parent: 'X-0002-BB' }),
    ];

    const roots = buildBacklogTree(items);

    assert.equal(roots.length, 1);
    assert.equal(roots[0]!.item.id, 'X-0001-AA');
    assert.equal(roots[0]!.children.length, 1);
    assert.equal(roots[0]!.children[0]!.item.id, 'X-0002-BB');
    assert.equal(roots[0]!.children[0]!.children[0]!.item.id, 'X-0003-CC');
  });

  it('treats items with an unknown parent as roots', () => {
    const items: JoyItem[] = [item({ id: 'X-0001-AA', parent: 'MISSING-9999-ZZ' })];
    const roots = buildBacklogTree(items);
    assert.equal(roots.length, 1);
    assert.equal(roots[0]!.item.id, 'X-0001-AA');
  });

  it('sorts siblings by status (in-progress first, closed last)', () => {
    const items: JoyItem[] = [
      item({ id: 'X-0001-AA', status: 'closed' }),
      item({ id: 'X-0002-BB', status: 'new' }),
      item({ id: 'X-0003-CC', status: 'in-progress' }),
      item({ id: 'X-0004-DD', status: 'review' }),
    ];

    const roots = buildBacklogTree(items);
    assert.deepEqual(
      roots.map((r) => r.item.id),
      ['X-0003-CC', 'X-0004-DD', 'X-0002-BB', 'X-0001-AA'],
    );
  });

  it('tiebreaks equal status by priority (critical first, low last)', () => {
    const items: JoyItem[] = [
      item({ id: 'X-0001-AA', status: 'new', priority: 'low' }),
      item({ id: 'X-0002-BB', status: 'new', priority: 'critical' }),
      item({ id: 'X-0003-CC', status: 'new', priority: 'medium' }),
    ];

    const roots = buildBacklogTree(items);
    assert.deepEqual(
      roots.map((r) => r.item.id),
      ['X-0002-BB', 'X-0003-CC', 'X-0001-AA'],
    );
  });

  it('falls back to id order when status and priority are equal', () => {
    const items: JoyItem[] = [item({ id: 'X-0002-BB' }), item({ id: 'X-0001-AA' })];
    const roots = buildBacklogTree(items);
    assert.deepEqual(
      roots.map((r) => r.item.id),
      ['X-0001-AA', 'X-0002-BB'],
    );
  });

  it('sorts children recursively', () => {
    const items: JoyItem[] = [
      item({ id: 'X-0001-AA', type: 'epic' }),
      item({ id: 'X-0010-CH', parent: 'X-0001-AA', status: 'closed' }),
      item({ id: 'X-0011-CH', parent: 'X-0001-AA', status: 'in-progress' }),
    ];

    const roots = buildBacklogTree(items);
    assert.deepEqual(
      roots[0]!.children.map((c) => c.item.id),
      ['X-0011-CH', 'X-0010-CH'],
    );
  });
});
