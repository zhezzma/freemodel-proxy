import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldClearFreezeOnOk } from '../src/tokenLifecycle.js';

test('does not clear a freeze created after the successful request started', () => {
  assert.equal(shouldClearFreezeOnOk(2_000, 1_000), false);
});

test('clears a freeze that existed before the successful request started', () => {
  assert.equal(shouldClearFreezeOnOk(1_000, 2_000), true);
});
