import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('loads account display name from email field', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'account-manager-'));
  const accountsPath = path.join(dir, 'accounts.json');
  const statePath = path.join(dir, 'token-state.json');
  fs.writeFileSync(accountsPath, JSON.stringify([
    { email: 'a@example.com', token: 'sk-a' },
    { email: 'b@example.com', token: 'sk-b' },
  ]));

  process.env.ACCOUNTS_FILE = accountsPath;
  process.env.TOKEN_STATE_FILE = statePath;

  const { pool } = await import(`../src/accountManager.js?email-test=${Date.now()}`);

  assert.deepEqual(pool.snapshot().map((entry) => entry.email), ['a@example.com', 'b@example.com']);
});
