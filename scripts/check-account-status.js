#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_ACCOUNTS = path.resolve(process.cwd(), '../freemodel-proxy-data/accounts.json');
const DEVICE_ID = 'a225c51dcb1945c1575dc6d055fe0a24f6c45a3f2f1c6ca6de67a5a3eccff067';
const ANTHROPIC_BETA = 'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,effort-2025-11-24';

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((v) => v.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function usage() {
  console.error(`Usage: node scripts/check-account-status.js --email=<email> [--accounts=<path>] [--upstream=<url>] [--model=<id>]`);
}

function loadAccount(accountsPath, emailNeedle) {
  const data = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
  if (!Array.isArray(data)) throw new Error(`accounts file must be an array: ${accountsPath}`);
  const needle = emailNeedle.toLowerCase();
  const account = data.find((item) => String(item?.email || '').toLowerCase().includes(needle));
  if (!account?.token) throw new Error(`account not found or has no token: ${emailNeedle}`);
  return account;
}

function buildRequest(token, model) {
  const sessionId = randomUUID();
  const body = {
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
    system: [
      { type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.126.507; cc_entrypoint=cli; cch=00a69;' },
      { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude.", cache_control: { type: 'ephemeral' } },
    ],
    metadata: {
      user_id: JSON.stringify({ device_id: DEVICE_ID, account_uuid: '', session_id: sessionId }),
    },
  };

  return {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'user-agent': 'claude-cli/2.1.126 (external, cli)',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': ANTHROPIC_BETA,
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-app': 'cli',
      'x-claude-code-session-id': sessionId,
      'x-stainless-arch': 'x64',
      'x-stainless-lang': 'js',
      'x-stainless-os': 'Linux',
      'x-stainless-package-version': '0.81.0',
      'x-stainless-retry-count': '0',
      'x-stainless-runtime': 'node',
      'x-stainless-runtime-version': 'v24.3.0',
      'x-stainless-timeout': '600',
    },
    body: JSON.stringify(body),
  };
}

async function main() {
  const email = arg('email', '');
  if (!email) {
    usage();
    process.exit(2);
  }

  const accountsPath = path.resolve(arg('accounts', DEFAULT_ACCOUNTS));
  const upstream = arg('upstream', 'https://cc.freemodel.dev').replace(/\/+$/, '');
  const model = arg('model', 'claude-sonnet-4-5-20250929');
  const account = loadAccount(accountsPath, email);
  const url = `${upstream}/v1/messages?beta=true`;

  console.log(JSON.stringify({
    account: account.email || '<anon>',
    disabled: Boolean(account.disabled),
    tokenTail: `***${String(account.token).slice(-4)}`,
    url,
    model,
  }, null, 2));

  const res = await fetch(url, buildRequest(account.token, model));
  const text = await res.text();
  console.log(JSON.stringify({
    status: res.status,
    statusText: res.statusText,
    contentType: res.headers.get('content-type'),
    retryAfter: res.headers.get('retry-after'),
    bodyPreview: text.slice(0, 2000),
  }, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
