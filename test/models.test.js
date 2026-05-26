import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

test('model refresh does not retry unknown client errors across tokens', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-test-'));
  const accountsPath = path.join(dir, 'accounts.json');
  const statePath = path.join(dir, 'token-state.json');
  fs.writeFileSync(accountsPath, JSON.stringify([
    { label: 'a@example.com', token: 'sk-a' },
    { label: 'b@example.com', token: 'sk-b' },
  ]));

  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.authorization);
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end('{"error":"bad request"}');
  });
  const address = await listen(server);

  process.env.ACCOUNTS_FILE = accountsPath;
  process.env.TOKEN_STATE_FILE = statePath;
  process.env.UPSTREAM_ANTHROPIC = `http://${address.address}:${address.port}`;
  process.env.UPSTREAM_OPENAI = `http://${address.address}:${address.port}`;

  try {
    const { listModels } = await import(`../src/models.js?models-test=${Date.now()}`);
    const result = await listModels();

    assert.deepEqual(result, { object: 'list', data: [] });
    assert.equal(seen.length, 2); // cc + api each try one token only, not both tokens per origin.
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
