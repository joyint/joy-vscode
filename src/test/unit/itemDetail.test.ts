import * as assert from 'node:assert';
import { sinceLine } from '../../itemDetail';

describe('itemDetail', () => {
  it('says in the head since when and by whom the item exists', () => {
    assert.strictEqual(
      sinceLine('2026-06-30T09:15:00+02:00', 'claude delegated-by:horst@example.com'),
      'since 2026-06-30 by claude delegated by horst@example.com',
    );
    assert.strictEqual(
      sinceLine('2026-06-30T09:15:00+02:00', 'horst@example.com'),
      'since 2026-06-30 by horst@example.com',
    );
    assert.strictEqual(sinceLine('2026-06-30T09:15:00+02:00', undefined), 'since 2026-06-30');
    assert.strictEqual(sinceLine(undefined, 'horst@example.com'), undefined);
  });
});
