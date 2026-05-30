import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchAccountUsage, listUsageAccounts } from '../src/usage.js';

test('lists all accounts without exposing session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-'));
  const accountsPath = path.join(dir, 'accounts.json');
  fs.writeFileSync(accountsPath, JSON.stringify([
    { email: 'a@example.com', token: 'sk-a-secret', session: 'session-a', sessionUpdatedAt: '2026-05-30T00:00:00.000Z' },
    { email: 'b@example.com', session: 'session-b' },
  ]));

  const result = listUsageAccounts(accountsPath);

  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts[0].email, 'a@example.com');
  assert.equal(result.accounts[0].tokenTail, '***cret');
  assert.equal(result.accounts[0].hasSession, true);
  assert.equal(result.accounts[0].session, undefined);
  assert.equal(typeof result.accounts[0].id, 'string');
});

test('fetches usage for a single listed account using bm_session', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-'));
  const accountsPath = path.join(dir, 'accounts.json');
  fs.writeFileSync(accountsPath, JSON.stringify([
    { email: 'a@example.com', token: 'sk-a-secret', session: 'session-a', sessionUpdatedAt: '2026-05-30T00:00:00.000Z' },
    { email: 'b@example.com', token: 'sk-b-secret', session: 'session-b' },
  ]));
  const accountId = listUsageAccounts(accountsPath).accounts[1].id;

  const seenCookies = [];
  const fetchImpl = async (url, init) => {
    seenCookies.push(init.headers.cookie);
    return new Response(JSON.stringify({
      totalRequests: 7,
      totalTokens: 1234,
      avgLatency: 321,
      todayCacheReadTokens: 55,
      todayCacheWriteTokens: 66,
      window5h: { usedCents: 100, limitCents: 1000, resetsAt: 1780131847 },
      windowWeek: { usedCents: 500, limitCents: 6667, resetsAt: 1780452642 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await fetchAccountUsage(accountsPath, accountId, { fetchImpl });

  assert.deepEqual(seenCookies, ['bm_session=session-b; ']);
  assert.equal(result.email, 'b@example.com');
  assert.equal(result.session, undefined);
  assert.equal(result.ok, true);
  assert.equal(result.usage.window5h.usedCents, 100);
});

test('returns an account-level error when session is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-'));
  const accountsPath = path.join(dir, 'accounts.json');
  fs.writeFileSync(accountsPath, JSON.stringify([
    { email: 'missing@example.com', token: 'sk-no-session' },
  ]));
  const accountId = listUsageAccounts(accountsPath).accounts[0].id;

  const result = await fetchAccountUsage(accountsPath, accountId, {
    fetchImpl: async () => { throw new Error('must not fetch without session'); },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing session');
});

test('returns not found for unknown account id', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-'));
  const accountsPath = path.join(dir, 'accounts.json');
  fs.writeFileSync(accountsPath, JSON.stringify([]));

  const result = await fetchAccountUsage(accountsPath, 'missing');

  assert.equal(result.ok, false);
  assert.equal(result.error, 'account not found');
});
