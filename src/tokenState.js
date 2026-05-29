import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function tokenStateKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 24);
}

export function loadTokenState(statePath) {
  try {
    const raw = fs.readFileSync(statePath, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function applyTokenState(entries, state, now = Date.now()) {
  for (const entry of entries) {
    const saved = state[tokenStateKey(entry.token)];
    if (!saved || saved.cause !== 'quota' || !Number.isFinite(saved.frozenUntil) || saved.frozenUntil <= now) continue;

    // 只恢复仍未到期的冻结状态；若内存中已有更晚冻结时间，保留更保守的值。
    if (!Number.isFinite(entry.frozenUntil) || saved.frozenUntil > entry.frozenUntil) {
      entry.frozenUntil = saved.frozenUntil;
    }
    entry.lastErr = saved.lastErr || entry.lastErr;
    entry.lastCause = saved.cause || entry.lastCause;
  }
}

export function persistTokenState(statePath, entries, now = Date.now()) {
  const state = {};
  for (const entry of entries) {
    if (entry.lastCause !== 'quota' || !Number.isFinite(entry.frozenUntil) || entry.frozenUntil <= now) continue;
    state[tokenStateKey(entry.token)] = {
      email: entry.email,
      tokenTail: `***${entry.token.slice(-4)}`,
      frozenUntil: entry.frozenUntil,
      frozenUntilIso: new Date(entry.frozenUntil).toISOString(),
      lastErr: entry.lastErr,
      cause: entry.lastCause,
      resetParsed: entry.resetParsed ?? false,
      fail: entry.fail,
    };
  }

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, statePath);
}
