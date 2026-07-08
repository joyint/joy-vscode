import * as assert from 'node:assert/strict';
import { buildBacklogTree, buildBacklogView, planDrop, type MilestoneNode } from '../../backlog';
import type { JoyItem, JoyMilestone } from '../../types';

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

describe('buildBacklogView', () => {
  const milestones: JoyMilestone[] = [
    { id: 'X-MS-02', title: 'Later', date: '2026-12-01' },
    { id: 'X-MS-01', title: 'Soon', date: '2026-08-01' },
    { id: 'X-MS-03', title: 'Undated' },
  ];

  it('groups milestone-linked roots under milestone nodes, dated first', () => {
    const items: JoyItem[] = [
      item({ id: 'X-0001-AA', milestone: 'X-MS-01' }),
      item({ id: 'X-0002-BB' }),
    ];

    const view = buildBacklogView(items, milestones);

    assert.deepEqual(
      view.map((node) => (node.kind === 'milestone' ? node.milestone.id : node.item.id)),
      ['X-MS-01', 'X-MS-02', 'X-MS-03', 'X-0002-BB'],
    );
    const soon = view[0] as MilestoneNode;
    assert.deepEqual(
      soon.children.map((c) => c.item.id),
      ['X-0001-AA'],
    );
  });

  it('keeps children with their parent even when the milestone differs', () => {
    const items: JoyItem[] = [
      item({ id: 'X-0001-AA', milestone: 'X-MS-01', type: 'epic' }),
      item({ id: 'X-0002-BB', parent: 'X-0001-AA', milestone: 'X-MS-02' }),
    ];

    const view = buildBacklogView(items, milestones);
    const soon = view[0] as MilestoneNode;
    assert.equal(soon.children[0]!.item.id, 'X-0001-AA');
    assert.equal(soon.children[0]!.children[0]!.item.id, 'X-0002-BB');
    const later = view[1] as MilestoneNode;
    assert.equal(later.children.length, 0);
  });

  it('returns the plain tree when there are no milestones', () => {
    const items: JoyItem[] = [item({ id: 'X-0001-AA', milestone: 'X-MS-01' })];
    const view = buildBacklogView(items, []);
    assert.equal(view.length, 1);
    assert.equal(view[0]!.kind, 'item');
  });
});

describe('planDrop', () => {
  const items: JoyItem[] = [
    item({ id: 'X-0001-AA', type: 'epic' }),
    item({ id: 'X-0002-BB', parent: 'X-0001-AA' }),
    item({ id: 'X-0003-CC', parent: 'X-0002-BB' }),
    item({ id: 'X-0004-DD', milestone: 'X-MS-01' }),
  ];
  const node = (id: string) => ({
    kind: 'item' as const,
    item: items.find((i) => i.id === id)!,
    children: [],
  });
  const milestoneNode: MilestoneNode = {
    kind: 'milestone',
    milestone: { id: 'X-MS-01', title: 'Soon' },
    children: [],
  };

  it('re-parents a drop onto another item', () => {
    assert.deepEqual(planDrop(['X-0004-DD'], node('X-0001-AA'), items), [
      { kind: 'reparent', id: 'X-0004-DD', parent: 'X-0001-AA' },
    ]);
  });

  it('rejects drops onto self, current parent, and descendants', () => {
    assert.deepEqual(planDrop(['X-0001-AA'], node('X-0001-AA'), items), []);
    assert.deepEqual(planDrop(['X-0002-BB'], node('X-0001-AA'), items), []);
    assert.deepEqual(planDrop(['X-0001-AA'], node('X-0003-CC'), items), []);
  });

  it('clears the parent on a drop into the empty view area', () => {
    assert.deepEqual(planDrop(['X-0002-BB'], undefined, items), [
      { kind: 'clearParent', id: 'X-0002-BB' },
    ]);
    assert.deepEqual(planDrop(['X-0001-AA'], undefined, items), []);
  });

  it('links to a milestone on a drop onto a milestone node', () => {
    assert.deepEqual(planDrop(['X-0001-AA'], milestoneNode, items), [
      { kind: 'link', id: 'X-0001-AA', milestone: 'X-MS-01' },
    ]);
    assert.deepEqual(planDrop(['X-0004-DD'], milestoneNode, items), []);
  });

  it('ignores unknown ids', () => {
    assert.deepEqual(planDrop(['NOPE-0001'], node('X-0001-AA'), items), []);
  });
});
