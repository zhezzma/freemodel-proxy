export function dashboardHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Freemodel Usage Grid</title>
<style>
:root { color-scheme: dark; --bg:#0b0d0f; --line:#2b3035; --text:#f4f7fb; --muted:#8f9aa8; --red:#ef3340; --amber:#ff9600; --green:#35d07f; }
* { box-sizing: border-box; }
body { margin:0; min-height:100vh; color:var(--text); background:radial-gradient(circle at 15% 0%, rgba(239,51,64,.14), transparent 34rem), radial-gradient(circle at 85% 10%, rgba(255,150,0,.09), transparent 30rem), linear-gradient(135deg,#090a0b 0%,var(--bg) 48%,#11100d 100%); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace; }
.shell { width:min(1540px, calc(100vw - 32px)); margin:0 auto; padding:26px 0 40px; }
.hero { display:flex; align-items:end; justify-content:space-between; gap:18px; margin-bottom:22px; }
h1 { margin:0; font-size:clamp(28px,4vw,54px); letter-spacing:-.06em; line-height:.9; }
.sub { margin-top:10px; color:var(--muted); font-size:13px; }
.summary { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin-bottom:18px; }
.stat { background:rgba(21,23,25,.82); border:1px solid var(--line); border-radius:18px; padding:14px 16px; }
.stat b { display:block; font-size:22px; margin-top:5px; }
.stat span { color:var(--muted); font-size:12px; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(360px,1fr)); gap:14px; }
.card { position:relative; overflow:hidden; background:linear-gradient(180deg,rgba(26,29,32,.96),rgba(17,19,21,.96)); border:1px solid var(--line); border-radius:20px; padding:18px 20px 16px; box-shadow:0 22px 70px rgba(0,0,0,.28); }
.card::before { content:''; position:absolute; inset:0 0 auto; height:2px; background:linear-gradient(90deg,var(--red),var(--amber)); opacity:.72; }
.card.err::before { background:var(--red); } .card.ok::before { background:var(--green); }
.head { display:flex; justify-content:space-between; gap:12px; align-items:start; margin-bottom:18px; }
.email { font-weight:800; max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meta { margin-top:5px; color:var(--muted); font-size:12px; }
.badge { border:1px solid var(--line); border-radius:999px; padding:4px 8px; color:var(--muted); font-size:12px; white-space:nowrap; }
.badge.hot { color:#ffb1b6; border-color:rgba(239,51,64,.55); } .badge.ok { color:#9dffc5; border-color:rgba(53,208,127,.5); }
.window { padding-top:2px; margin-top:18px; } .window + .window { border-top:1px solid rgba(255,255,255,.055); padding-top:18px; }
.row { display:flex; align-items:baseline; justify-content:space-between; gap:16px; }
.label { font-weight:900; color:#fff; } .reset { color:var(--muted); font-size:12px; margin-top:6px; }
.money { text-align:right; font-weight:900; letter-spacing:-.03em; } .money small { color:var(--muted); font-weight:600; }
.exceeded { color:#ff5a65; font-size:12px; margin-top:2px; } .used { color:var(--amber); font-size:12px; margin-top:2px; }
.bar { height:6px; background:#1d2023; border-radius:999px; overflow:hidden; margin-top:18px; }
.fill { height:100%; width:0; border-radius:inherit; background:var(--amber); box-shadow:0 0 18px currentColor; } .fill.danger { background:var(--red); } .fill.good { background:var(--green); }
.metrics { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; margin-top:16px; color:var(--muted); font-size:12px; }
.metric { background:rgba(255,255,255,.025); border:1px solid rgba(255,255,255,.05); border-radius:12px; padding:9px; } .metric b { color:var(--text); display:block; margin-top:3px; font-size:13px; }
.error { color:#ff9aa1; background:rgba(239,51,64,.08); border:1px solid rgba(239,51,64,.22); padding:12px; border-radius:14px; font-size:13px; }
@media (max-width:760px) { .summary { grid-template-columns:repeat(2,1fr); } .grid { grid-template-columns:1fr; } .hero { align-items:start; flex-direction:column; } }
</style>
</head>
<body>
  <main class="shell">
    <section class="hero"><div><h1>Freemodel<br/>Usage Grid</h1><div class="sub" id="subtitle">先列账号，再由浏览器逐个请求 usage；本地缓存优先显示</div></div></section>
    <section class="summary" id="summary"></section>
    <section class="grid" id="accountGrid"></section>
  </main>
<script>
const CACHE_PREFIX = 'usage-cache-v1:';
const CACHE_TTL_MS = 10 * 60 * 1000;
const grid = document.getElementById('accountGrid');
const summary = document.getElementById('summary');
const subtitle = document.getElementById('subtitle');
const money = (cents) => '$' + ((Number(cents || 0) / 100).toFixed(2));
const num = (n) => Number(n || 0).toLocaleString();
const pct = (used, limit) => limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
const cacheKey = (id) => CACHE_PREFIX + id;
function readCache(id) { try { const cached = JSON.parse(localStorage.getItem(cacheKey(id)) || 'null'); return cached && cached.cachedAt && Date.now() - Date.parse(cached.cachedAt) < CACHE_TTL_MS ? cached : null; } catch { return null; } }
function writeCache(item) { try { localStorage.setItem(cacheKey(item.id), JSON.stringify(item)); } catch {} }
function resetText(ts) { if (!ts) return '无重置时间'; const ms = ts * 1000 - Date.now(); if (ms <= 0) return '正在重置'; const min = Math.floor(ms / 60000); if (min < 60) return min + ' 分钟后重置'; if (min < 1440) return Math.floor(min / 60) + ' 小时 ' + (min % 60) + ' 分钟后重置'; return '将于 ' + new Date(ts * 1000).toLocaleString('zh-CN', { weekday:'short', hour:'2-digit', minute:'2-digit' }) + ' 重置'; }
function statusFor(account) { const u = account.usage; if (!account.ok) return ['等待/错误','hot']; if (u.window5h?.usedCents >= u.window5h?.limitCents) return ['5h 超额','hot']; if (u.windowWeek?.usedCents >= u.windowWeek?.limitCents) return ['7d 超额','hot']; return ['正常','ok']; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch])); }
function windowBlock(title, w) { const p = pct(w?.usedCents || 0, w?.limitCents || 0); const danger = p >= 100; const fillClass = danger ? 'danger' : p < 55 ? 'good' : ''; return '<div class="window"><div class="row"><div><div class="label">' + title + '</div><div class="reset">' + resetText(w?.resetsAt) + '</div></div><div class="money">' + money(w?.usedCents) + ' <small>/</small> ' + money(w?.limitCents) + '<div class="' + (danger ? 'exceeded' : 'used') + '">' + (danger ? '已达限额' : '已用 ' + p + '%') + '</div></div></div><div class="bar"><div class="fill ' + fillClass + '" style="width:' + p + '%"></div></div></div>'; }
function card(account) { const [label, badge] = statusFor(account); const meta = (account.tokenTail || '') + (account.sessionUpdatedAt ? ' · session ' + new Date(account.sessionUpdatedAt).toLocaleString('zh-CN') : '') + (account.cachedAt ? ' · 缓存 ' + new Date(account.cachedAt).toLocaleTimeString('zh-CN') : ''); if (!account.ok) return '<article class="card err" id="acc-' + account.id + '"><div class="head"><div><div class="email">' + esc(account.email) + '</div><div class="meta">' + esc(meta) + '</div></div><span class="badge hot">' + label + '</span></div><div class="error">' + esc(account.error || (account.hasSession ? '请求中...' : 'missing session')) + '</div></article>'; const u = account.usage; return '<article class="card ok" id="acc-' + account.id + '"><div class="head"><div><div class="email" title="' + esc(account.email) + '">' + esc(account.email) + '</div><div class="meta">' + esc(meta) + '</div></div><span class="badge ' + badge + '">' + label + '</span></div>' + windowBlock('5小时窗口', u.window5h) + windowBlock('7天窗口', u.windowWeek) + '<div class="metrics"><div class="metric">请求数<b>' + num(u.totalRequests) + '</b></div><div class="metric">Tokens<b>' + num(u.totalTokens) + '</b></div><div class="metric">平均延迟<b>' + num(u.avgLatency) + ' ms</b></div><div class="metric">Cache R/W<b>' + num(u.todayCacheReadTokens) + ' / ' + num(u.todayCacheWriteTokens) + '</b></div></div></article>'; }
function render(accounts) { const ok = accounts.filter(a => a.ok).length; const totals = accounts.reduce((acc, a) => { const u = a.usage || {}; acc.req += Number(u.totalRequests || 0); acc.tokens += Number(u.totalTokens || 0); acc.cacheRead += Number(u.todayCacheReadTokens || 0); acc.cacheWrite += Number(u.todayCacheWriteTokens || 0); return acc; }, { req:0, tokens:0, cacheRead:0, cacheWrite:0 }); subtitle.textContent = '账号 ' + accounts.length + ' · 已加载 ' + ok + ' · ' + new Date().toLocaleString('zh-CN'); summary.innerHTML = '<div class="stat"><span>账号</span><b>' + ok + '/' + accounts.length + '</b></div><div class="stat"><span>请求数</span><b>' + num(totals.req) + '</b></div><div class="stat"><span>Tokens</span><b>' + num(totals.tokens) + '</b></div><div class="stat"><span>Cache R/W</span><b>' + num(totals.cacheRead) + ' / ' + num(totals.cacheWrite) + '</b></div>'; grid.innerHTML = accounts.map(card).join(''); }
async function fetchOne(account, accounts) { const res = await fetch(\`/api/accounts/\${encodeURIComponent(account.id)}/usage\`, { cache:'no-store' }); const usage = await res.json(); const merged = { ...account, ...usage, cachedAt: new Date().toISOString() }; if (merged.ok) writeCache(merged); const idx = accounts.findIndex(a => a.id === account.id); if (idx >= 0) { accounts[idx] = merged; render(accounts); } }
async function loadAccounts() { const res = await fetch('/api/accounts', { cache:'no-store' }); const data = await res.json(); const accounts = data.accounts.map(account => { const cached = readCache(account.id); return cached || { ...account, ok:false, error:'请求中...' }; }); render(accounts); data.accounts.forEach(account => { const cached = readCache(account.id); if (!cached) fetchOne(account, accounts); }); }
loadAccounts();
</script>
</body>
</html>`;
}
