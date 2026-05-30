import crypto from 'node:crypto';
import fs from 'node:fs';

const USAGE_URL = 'https://freemodel.dev/api/usage';

function readAccounts(accountsPath) {
  try {
    const data = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function accountId(account, index) {
  const stable = [account.email, account.user, account.token, account.session, index].map((v) => String(v || '')).join('\n');
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 24);
}

function accountPublicFields(account, index) {
  const token = typeof account.token === 'string' ? account.token : '';
  return {
    id: accountId(account, index),
    email: account.email || account.user || '<anon>',
    tokenTail: token ? `***${token.slice(-4)}` : undefined,
    sessionUpdatedAt: account.sessionUpdatedAt,
    hasSession: typeof account.session === 'string' && account.session.length > 0,
  };
}

function findAccountById(accounts, id) {
  return accounts.find((account, index) => accountId(account, index) === id);
}

async function fetchUsage(account, index, fetchImpl) {
  const base = accountPublicFields(account, index);
  if (!base.hasSession) return { ...base, ok: false, error: 'missing session' };

  try {
    const res = await fetchImpl(USAGE_URL, {
      method: 'GET',
      headers: {
        accept: '*/*',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        cookie: `bm_session=${account.session}; `,
        referer: 'https://freemodel.dev/dashboard/usage',
      },
    });
    const text = await res.text();
    if (!res.ok) return { ...base, ok: false, error: `${res.status}: ${text.slice(0, 160)}` };
    return { ...base, ok: true, usage: JSON.parse(text), fetchedAt: new Date().toISOString() };
  } catch (err) {
    return { ...base, ok: false, error: err.message, fetchedAt: new Date().toISOString() };
  }
}

export function listUsageAccounts(accountsPath) {
  const accounts = readAccounts(accountsPath);
  return {
    updatedAt: new Date().toISOString(),
    accounts: accounts.map((account, index) => accountPublicFields(account, index)),
  };
}

export async function fetchAccountUsage(accountsPath, id, { fetchImpl = fetch } = {}) {
  const accounts = readAccounts(accountsPath);
  const index = accounts.findIndex((account, i) => accountId(account, i) === id);
  const account = index >= 0 ? findAccountById(accounts, id) : undefined;
  if (!account) return { id, ok: false, error: 'account not found' };
  return fetchUsage(account, index, fetchImpl);
}
