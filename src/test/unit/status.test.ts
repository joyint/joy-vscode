import * as assert from 'node:assert/strict';
import { STATUSES, moveArgs } from '../../status';

describe('moveArgs', () => {
  it('covers every workflow status as a target', () => {
    for (const target of STATUSES) {
      const from = target === 'new' ? 'open' : 'new';
      assert.ok(moveArgs('X-0001-AA', from, target), `expected args for target ${target}`);
    }
  });

  it('prefers the shortcut verbs', () => {
    assert.deepEqual(moveArgs('X', 'new', 'open'), ['approve', 'X']);
    assert.deepEqual(moveArgs('X', 'open', 'in-progress'), ['start', 'X']);
    assert.deepEqual(moveArgs('X', 'in-progress', 'review'), ['submit', 'X']);
    assert.deepEqual(moveArgs('X', 'review', 'closed'), ['close', 'X']);
    assert.deepEqual(moveArgs('X', 'open', 'deferred'), ['defer', 'X']);
  });

  it('uses reopen when leaving closed or deferred for open', () => {
    assert.deepEqual(moveArgs('X', 'closed', 'open'), ['reopen', 'X']);
    assert.deepEqual(moveArgs('X', 'deferred', 'open'), ['reopen', 'X']);
  });

  it('uses rework from review back to in-progress', () => {
    assert.deepEqual(moveArgs('X', 'review', 'in-progress'), ['rework', 'X']);
  });

  it('sets the status directly for a move back to new', () => {
    assert.deepEqual(moveArgs('X', 'closed', 'new'), ['status', 'X', 'new']);
  });

  it('returns undefined for a no-op move', () => {
    assert.equal(moveArgs('X', 'open', 'open'), undefined);
  });
});
