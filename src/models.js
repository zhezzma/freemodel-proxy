// 从上游 /v1/models 拉取模型列表，5 分钟缓存。

import { settings } from './config.js';
import { pool } from './accountManager.js';

const TTL = 5 * 60 * 1000;
let cached = null;
let cachedAt = 0;
let flying = null;

async function pull() {
  for (const entry of pool.next()) {
    try {
      const res = await fetch(`${settings.upstreamOrigin}/v1/models`, {
        headers: { authorization: `Bearer ${entry.token}` },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.object === 'list' && Array.isArray(data.data)) {
        pool.markOk(entry);
        return data;
      }
    } catch { /* try next token */ }
  }
  return null;
}

async function refresh() {
  if (flying) return flying;
  flying = (async () => {
    try {
      const data = await pull();
      if (data) { cached = data; cachedAt = Date.now(); }
      return cached;
    } finally { flying = null; }
  })();
  return flying;
}

export async function listModels() {
  if (cached && Date.now() - cachedAt < TTL) return cached;
  const r = await refresh();
  return r || cached || { object: 'list', data: [] };
}

export async function getModel(id) {
  const list = await listModels();
  return list.data.find((m) => m.id === id) || null;
}
