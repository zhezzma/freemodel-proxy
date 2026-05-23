import { settings } from './config.js';
import { pool } from './accountManager.js';

const STRIP_REQ = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'host', 'content-length', 'accept-encoding',
]);

const STRIP_RES = new Set([
  'transfer-encoding', 'connection', 'keep-alive',
  'content-encoding', 'content-length',
]);

function upstreamTarget(clientUrl) {
  const u = new URL(clientUrl);
  return `${settings.upstreamOrigin}${u.pathname}${u.search}`;
}

async function drainBody(res) {
  try { return new TextDecoder().decode(await res.arrayBuffer()); } catch { return ''; }
}

function diagnose(status, body) {
  if (status === 429) return { retry: true, cause: 'rate' };
  if (status === 403) {
    const quota = /quota|exceed|insufficient|limit/i.test(body);
    return { retry: true, cause: quota ? 'quota' : 'perm' };
  }
  if (status === 401) return { retry: true, cause: 'perm' };
  if (status >= 500) return { retry: true, cause: 'srv' };
  return { retry: false, cause: 'badreq' };
}

export async function relay(req) {
  if (pool.count() === 0) {
    return Response.json({ error: { message: 'no tokens configured' } }, { status: 503 });
  }

  const method = req.method.toUpperCase();
  const bodyBytes = (method !== 'GET' && method !== 'HEAD') ? await req.arrayBuffer() : undefined;
  const target = upstreamTarget(req.url);

  const keepHeaders = {};
  for (const [k, v] of req.headers) {
    const lk = k.toLowerCase();
    if (STRIP_REQ.has(lk)) continue;
    if (lk === 'authorization') continue;
    keepHeaders[k] = v;
  }

  const attempts = [];

  for (const entry of pool.next(settings.maxAttempts || undefined)) {
    const hdrs = { ...keepHeaders, authorization: `Bearer ${entry.token}` };

    let upstream;
    try {
      upstream = await fetch(target, { method, headers: hdrs, body: bodyBytes, duplex: 'half' });
    } catch (err) {
      pool.markFail(entry, 'srv', `fetch: ${err.message}`);
      attempts.push({ label: entry.label, status: 0, cause: 'fetchErr', detail: err.message });
      continue;
    }

    if (upstream.ok) {
      pool.markOk(entry);
      return streamBack(upstream, entry.label);
    }

    const errBody = await drainBody(upstream);
    const diag = diagnose(upstream.status, errBody);
    pool.markFail(entry, diag.cause, `${upstream.status}: ${errBody.slice(0, 160)}`);
    attempts.push({ label: entry.label, status: upstream.status, cause: diag.cause, detail: errBody });

    if (!diag.retry) {
      return echoResponse(upstream.status, upstream.headers, errBody, entry.label);
    }
  }

  if (attempts.length === 0) {
    return Response.json({ error: { message: 'all tokens frozen' } }, { status: 503 });
  }
  const last = attempts[attempts.length - 1];
  return Response.json({
    error: {
      message: `exhausted ${attempts.length} token(s): ${last.cause}`,
      attempts: attempts.map((a) => ({ label: a.label, status: a.status, cause: a.cause })),
    },
  }, { status: last.status >= 400 ? last.status : 502 });
}

function streamBack(upstream, tag) {
  const h = new Headers();
  for (const [k, v] of upstream.headers) {
    if (STRIP_RES.has(k.toLowerCase())) continue;
    h.set(k, v);
  }
  h.set('x-served-by', tag);
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: h });
}

function echoResponse(status, src, body, tag) {
  const h = new Headers();
  for (const [k, v] of src) {
    if (STRIP_RES.has(k.toLowerCase())) continue;
    h.set(k, v);
  }
  h.set('x-served-by', tag);
  return new Response(body, { status, headers: h });
}
