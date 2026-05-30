import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyTokenState,
  loadTokenState,
  persistTokenState,
  tokenStateKey,
} from '../src/tokenState.js';

test('applies persisted frozen state to matching token without exposing raw token', () => {
  const token = 'sk-secret-token';
  const key = tokenStateKey(token);
  const entries = [{ email: 'user@example.com', token, frozenUntil: 0, lastErr: undefined }];
  const state = {
    [key]: {
      email: 'user@example.com',
      frozenUntil: 1_800_000_000_000,
      lastErr: '402: quota',
      cause: 'quota',
    },
  };

  applyTokenState(entries, state, new Date('2026-05-26T00:00:00Z').getTime());

  assert.equal(entries[0].frozenUntil, 1_800_000_000_000);
  assert.equal(entries[0].lastErr, '402: quota');
  assert.equal(entries[0].lastCause, 'quota');
  assert.equal(key.includes(token), false);
});

test('restores persisted reset parse marker for active quota freezes', () => {
  const token = 'sk-secret-token';
  const entries = [{ email: 'user@example.com', token, frozenUntil: 0 }];
  const state = {
    [tokenStateKey(token)]: {
      email: 'user@example.com',
      frozenUntil: 1_800_000_000_000,
      lastErr: '402: quota',
      cause: 'quota',
      resetParsed: true,
    },
  };

  applyTokenState(entries, state, new Date('2026-05-26T00:00:00Z').getTime());

  assert.equal(entries[0].resetParsed, true);
});

test('ignores expired persisted frozen state', () => {
  const entries = [{ email: 'user@example.com', token: 'sk-secret-token', frozenUntil: 0 }];
  const state = {
    [tokenStateKey(entries[0].token)]: {
      email: 'user@example.com',
      frozenUntil: 1_000,
      lastErr: 'old quota',
      cause: 'quota',
    },
  };

  applyTokenState(entries, state, 2_000);

  assert.equal(entries[0].frozenUntil, 0);
  assert.equal(entries[0].lastErr, undefined);
});

test('ignores persisted non-quota frozen state', () => {
  const entries = [{ email: 'user@example.com', token: 'sk-secret-token', frozenUntil: 0 }];
  const state = {
    [tokenStateKey(entries[0].token)]: {
      email: 'user@example.com',
      frozenUntil: 5_000,
      lastErr: '403: perm',
      cause: 'perm',
    },
  };

  applyTokenState(entries, state, 1_000);

  assert.equal(entries[0].frozenUntil, 0);
  assert.equal(entries[0].lastErr, undefined);
});

test('persists active frozen entries and prunes recovered tokens', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-state-'));
  const statePath = path.join(dir, 'token-state.json');
  const frozenToken = 'sk-frozen';
  const recoveredToken = 'sk-recovered';
  const entries = [
    { email: 'frozen@example.com', token: frozenToken, frozenUntil: 5_000, lastErr: '402: quota', lastCause: 'quota', fail: 2 },
    { email: 'perm@example.com', token: 'sk-perm', frozenUntil: 5_000, lastErr: '403: perm', lastCause: 'perm', fail: 1 },
    { email: 'ok@example.com', token: recoveredToken, frozenUntil: 0, lastErr: undefined, fail: 0 },
  ];

  persistTokenState(statePath, entries, 1_000);
  const state = loadTokenState(statePath);

  assert.deepEqual(Object.keys(state), [tokenStateKey(frozenToken)]);
  assert.equal(state[tokenStateKey(frozenToken)].email, 'frozen@example.com');
  assert.equal(state[tokenStateKey(frozenToken)].lastErr, '402: quota');
  assert.equal(state[tokenStateKey(frozenToken)].cause, 'quota');
});

test('persists reset parse marker only when explicitly true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-state-'));
  const statePath = path.join(dir, 'token-state.json');
  const parsedToken = 'sk-parsed';
  const fallbackToken = 'sk-fallback';
  const entries = [
    { email: 'parsed@example.com', token: parsedToken, frozenUntil: 5_000, lastErr: '402: quota', lastCause: 'quota', resetParsed: true },
    { email: 'fallback@example.com', token: fallbackToken, frozenUntil: 5_000, lastErr: '402: quota', lastCause: 'quota', resetParsed: false },
  ];

  persistTokenState(statePath, entries, 1_000);
  const state = loadTokenState(statePath);

  assert.equal(state[tokenStateKey(parsedToken)].resetParsed, true);
  assert.equal('resetParsed' in state[tokenStateKey(fallbackToken)], false);
});
