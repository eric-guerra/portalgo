import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPaymentOptimistically, idempotencyKey, overdueIds, selectedTotal, toggle } from '../src/lib/selection.ts';

const invs = [
  { id: 'a', dueOn: '2024-03-01', balanceCents: 10000, status: 'OPEN' },
  { id: 'b', dueOn: '2024-04-01', balanceCents: 3000, status: 'PARTIALLY_PAID' },
  { id: 'c', dueOn: '2024-05-01', balanceCents: 7000, status: 'OPEN' },
  { id: 'd', dueOn: '2024-01-01', balanceCents: 500, status: 'DISPUTED' },
];

test('select overdue skips disputed and future invoices', () => {
  assert.deepEqual([...overdueIds(invs, '2024-04-15')].sort(), ['a', 'b']);
});

test('toggle and totals', () => {
  let s = toggle(new Set(), 'a');
  s = toggle(s, 'c');
  assert.equal(selectedTotal(invs, s), 17000);
  assert.equal(selectedTotal(invs, toggle(s, 'a')), 7000);
});

test('idempotency key is stable for the same intent and changes otherwise', () => {
  const k1 = idempotencyKey(new Set(['b', 'a']), 13000, 'n1');
  assert.equal(k1, idempotencyKey(new Set(['a', 'b']), 13000, 'n1'));
  assert.notEqual(k1, idempotencyKey(new Set(['a', 'b']), 12000, 'n1'));
  assert.match(k1, /^[A-Za-z0-9_-]{8,64}$/);
});

test('optimistic update allocates oldest first', () => {
  const out = applyPaymentOptimistically(invs, new Set(['c', 'a']), 12000);
  assert.deepEqual(out.map((i) => [i.id, i.balanceCents, i.status]), [
    ['a', 0, 'PAID'], ['b', 3000, 'PARTIALLY_PAID'], ['c', 5000, 'PARTIALLY_PAID'], ['d', 500, 'DISPUTED'],
  ]);
});
