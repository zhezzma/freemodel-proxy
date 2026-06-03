import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function tokenStateKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 24);
}

// 需要跨重启持久化/恢复的冻结原因：
//   - quota：额度耗尽，冻结到重置时间
//   - incompat：后端不兼容（thinking 多轮回传 / 未开通 Anthropic 端点），冻结 10 分钟
// rate / srv / perm 等短暂或一次性故障不落盘。
const PERSIST_CAUSES = new Set(['quota', 'incompat']);

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
    if (!saved || !PERSIST_CAUSES.has(saved.cause) || !Number.isFinite(saved.frozenUntil) || saved.frozenUntil <= now) continue;

    // 只恢复仍未到期的冻结状态；若内存中已有更晚冻结时间，保留更保守的值。
    if (!Number.isFinite(entry.frozenUntil) || saved.frozenUntil > entry.frozenUntil) {
      entry.frozenUntil = saved.frozenUntil;
    }
    entry.lastErr = saved.lastErr || entry.lastErr;
    entry.lastCause = saved.cause || entry.lastCause;
    entry.resetParsed = saved.resetParsed ?? entry.resetParsed;
  }
}

export function persistTokenState(statePath, entries, now = Date.now()) {
  const state = {};
  for (const entry of entries) {
    if (entry.lastCause !== 'quota' && entry.lastCause !== 'incompat') continue;
    if (!Number.isFinite(entry.frozenUntil) || entry.frozenUntil <= now) continue;
    const saved = {
      email: entry.email,
      tokenTail: `***${entry.token.slice(-4)}`,
      frozenUntil: entry.frozenUntil,
      frozenUntilIso: new Date(entry.frozenUntil).toISOString(),
      lastErr: entry.lastErr,
      cause: entry.lastCause,
      fail: entry.fail,
    };
    // 只持久化有诊断价值的标记；未解析成功时省略字段，避免状态文件被 resetParsed:false 淹没。
    if (entry.resetParsed === true) saved.resetParsed = true;
    state[tokenStateKey(entry.token)] = saved;
  }

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, statePath);
}
