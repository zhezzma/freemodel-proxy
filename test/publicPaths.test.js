import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicPath } from '../src/publicPaths.js';

test('dashboard and browser-driven usage endpoints are public', () => {
  assert.equal(isPublicPath('/'), true);
  assert.equal(isPublicPath('/api/accounts'), true);
  assert.equal(isPublicPath('/api/accounts/abc/usage'), true);
  assert.equal(isPublicPath('/health'), true);
  assert.equal(isPublicPath('/status'), true);
  assert.equal(isPublicPath('/v1/messages'), false);
});
