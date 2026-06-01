import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardHtml } from '../src/dashboard.js';

test('dashboard html lists accounts first and fetches per-account usage with local cache', () => {
  const html = dashboardHtml();

  assert.match(html, /Freemodel Usage Grid/);
  assert.match(html, /id="accountGrid"/);
  assert.match(html, /\/api\/accounts/);
  assert.match(html, /\/api\/accounts\/\$\{encodeURIComponent\(account\.id\)\}\/usage/);
  assert.match(html, /localStorage/);
  assert.match(html, /usage-cache-v1/);
  assert.match(html, /CACHE_TTL_MS = 10 \* 60 \* 1000/);
  assert.match(html, /Date\.now\(\) - Date\.parse\(cached\.cachedAt\) < CACHE_TTL_MS/);
  assert.match(html, /IntersectionObserver/);
  assert.match(html, /rootMargin: '600px 0px'/);
  assert.match(html, /observeAccountCards\(accounts\)/);
  assert.match(html, /fetchOne\(account, accounts\)/);
  assert.doesNotMatch(html, /data\.accounts\.forEach\(account => \{ const cached = readCache\(account\.id\); if \(!cached\) fetchOne\(account, accounts\); \}\)/);
  assert.doesNotMatch(html, /force/);
  assert.doesNotMatch(html, /setInterval/);
  assert.doesNotMatch(html, /refreshBtn/);
  assert.match(html, /5小时窗口/);
  assert.match(html, /7天窗口/);
});
