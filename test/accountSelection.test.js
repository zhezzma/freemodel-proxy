import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountSelectionMode, selectAccountOrder } from '../src/accountSelection.js';

const entries = ['a', 'b', 'c'].map((email) => ({ email, disabled: false, frozenUntil: 0 }));
const emails = (items) => items.map((entry) => entry.email);

test('sticky mode keeps using the current account while it is available', () => {
  const state = { index: 0 };

  assert.deepEqual(emails(selectAccountOrder(entries, 'sticky', state, 10, () => 0)), ['a', 'b', 'c']);
  assert.equal(state.index, 0);
  assert.deepEqual(emails(selectAccountOrder(entries, 'sticky', state, 10, () => 0)), ['a', 'b', 'c']);
  assert.equal(state.index, 0);
});

test('sticky mode advances to the next available account when current is frozen', () => {
  const state = { index: 0 };
  const frozen = [
    { email: 'a', disabled: false, frozenUntil: 2_000 },
    { email: 'b', disabled: false, frozenUntil: 0 },
    { email: 'c', disabled: false, frozenUntil: 0 },
  ];

  assert.deepEqual(emails(selectAccountOrder(frozen, 'sticky', state, 10, () => 1_000)), ['b', 'c']);
  assert.equal(state.index, 1);
});

test('round-robin mode advances starting account on each selection', () => {
  const state = { index: 0 };

  assert.deepEqual(emails(selectAccountOrder(entries, 'round-robin', state, 10, () => 0)), ['a', 'b', 'c']);
  assert.equal(state.index, 1);
  assert.deepEqual(emails(selectAccountOrder(entries, 'round-robin', state, 10, () => 0)), ['b', 'c', 'a']);
  assert.equal(state.index, 2);
});

test('round-robin mode advances by one even when current account is disabled', () => {
  const state = { index: 0 };
  const mixed = [
    { email: 'a', disabled: true, frozenUntil: 0 },
    { email: 'b', disabled: false, frozenUntil: 0 },
    { email: 'c', disabled: false, frozenUntil: 0 },
  ];

  assert.deepEqual(emails(selectAccountOrder(mixed, 'round-robin', state, 10, () => 0)), ['b', 'c']);
  assert.equal(state.index, 1);
});

test('round-robin mode advances by one even when all accounts are unavailable', () => {
  const state = { index: 0 };
  const unavailable = entries.map((entry) => ({ ...entry, frozenUntil: 2_000 }));

  assert.deepEqual(selectAccountOrder(unavailable, 'round-robin', state, 10, () => 1_000), []);
  assert.equal(state.index, 1);
});

test('random mode uses random ordering without duplicate accounts', () => {
  const state = { index: 0 };
  const order = emails(selectAccountOrder(entries, 'random', state, 10, () => 0, () => 0));

  assert.deepEqual(order.toSorted(), ['a', 'b', 'c']);
  assert.notDeepEqual(order, ['a', 'b', 'c']);
});

test('random mode excludes disabled and frozen accounts', () => {
  const state = { index: 0 };
  const mixed = [
    { email: 'a', disabled: true, frozenUntil: 0 },
    { email: 'b', disabled: false, frozenUntil: 2_000 },
    { email: 'c', disabled: false, frozenUntil: 0 },
  ];

  assert.deepEqual(emails(selectAccountOrder(mixed, 'random', state, 10, () => 1_000, () => 0)), ['c']);
});

test('selection order respects attempt limit', () => {
  const state = { index: 0 };

  assert.deepEqual(emails(selectAccountOrder(entries, 'sticky', state, 2, () => 0)), ['a', 'b']);
});

test('round-robin mode handles empty account list without corrupting index', () => {
  const state = { index: 0 };

  assert.deepEqual(selectAccountOrder([], 'round-robin', state, 10, () => 0), []);
  assert.equal(state.index, 0);
});

test('invalid selection mode falls back to sticky', () => {
  assert.equal(normalizeAccountSelectionMode(undefined), 'sticky');
  assert.equal(normalizeAccountSelectionMode('round_robin'), 'sticky');
});
