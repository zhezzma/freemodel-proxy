// 从两个上游 /v1/models 拉取模型列表并聚合去重，5 分钟缓存。

import { settings } from './config.js';
import { pool } from './accountManager.js';

const TTL = 5 * 60 * 1000;
let cached = null;
let cachedAt = 0;
let flying = null;

/** 从单个上游拉模型列表 */
async function pullFrom(origin) {
  for (const entry of pool.next()) {
    try {
      const res = await fetch(`${origin}/v1/models`, {
        headers: {
          authorization: `Bearer ${entry.token}`,
          'user-agent': 'claude-code/2.1.126',
          'anthropic-version': '2023-06-01',
          accept: '*/*',
          connection: 'keep-alive',
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.object === 'list' && Array.isArray(data.data)) {
        pool.markOk(entry);
        return data.data;
      }
    } catch { /* next token */ }
  }
  return [];
}

/** 并发拉两个上游，聚合去重 */
async function pull() {
  const [cc, api] = await Promise.all([
    pullFrom(settings.upstreamAnthropic),
    pullFrom(settings.upstreamOpenAI),
  ]);
  const seen = new Set();
  const merged = [];
  for (const m of [...cc, ...api]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    merged.push(m);
  }
  merged.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`[models] cc=${cc.length} api=${api.length} merged=${merged.length}`);
  return { object: 'list', data: merged };
}

async function refresh() {
  if (flying) return flying;
  flying = (async () => {
    try {
      const data = await pull();
      if (data?.data?.length) { cached = data; cachedAt = Date.now(); }
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
