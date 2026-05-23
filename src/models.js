// 从上游 /v1/models 拉取模型列表（OpenAI 格式），5 分钟缓存，直接透传并缓存。

import { config } from './config.js';
import { accountManager } from './accountManager.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null;
let cacheAt = 0;
let inflight = null;

async function fetchFromUpstream() {
  for (const acc of accountManager.pick()) {
    try {
      const res = await fetch(`${config.upstream}/v1/models`, {
        headers: { authorization: `Bearer ${acc.apiKey}` },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.object === 'list' && Array.isArray(data.data)) {
        accountManager.reportSuccess(acc);
        return data;
      }
    } catch {
      // 换下一个账号
    }
  }
  return null;
}

async function refresh() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await fetchFromUpstream();
      if (data) {
        cache = data;
        cacheAt = Date.now();
      }
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export async function listModels() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;
  const r = await refresh();
  if (r) return r;
  if (cache) return cache;
  return { object: 'list', data: [] };
}

export async function retrieveModel(id) {
  const list = await listModels();
  return list.data.find((m) => m.id === id) || null;
}
