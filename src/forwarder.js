import { config } from './config.js';
import { accountManager } from './accountManager.js';

// HTTP/1.1 hop-by-hop headers — 不透传
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'host',
  'content-length',
  'accept-encoding', // fetch 自行处理解压
]);

const RESP_STRIP = new Set([
  'transfer-encoding',
  'connection',
  'keep-alive',
  'content-encoding', // 已解压
  'content-length',   // 流式时长度未知
]);

/** 构造上游 URL：去掉客户端的 ?key= 参数（若有），保留其他 query */
function buildUpstreamUrl(originalUrl) {
  const u = new URL(originalUrl);
  u.searchParams.delete('key');
  return `${config.upstream}${u.pathname}${u.search}`;
}

async function readErrorBody(res) {
  try {
    const buf = await res.arrayBuffer();
    return new TextDecoder().decode(buf);
  } catch {
    return '';
  }
}

function classifyFailure(status, bodyText) {
  if (status === 429) return { retryable: true, reason: 'rateLimit' };
  if (status === 403) {
    const isQuota = /quota|exceed|insufficient|limit/i.test(bodyText);
    return { retryable: true, reason: isQuota ? 'quota' : 'permission' };
  }
  if (status === 401) return { retryable: true, reason: 'permission' };
  if (status >= 500 && status < 600) return { retryable: true, reason: 'serverError' };
  return { retryable: false, reason: 'clientError' };
}

/**
 * 透明转发 + 多账号轮转
 *
 * @param {Request} req
 * @returns {Promise<Response>}
 */
export async function forward(req) {
  if (accountManager.size() === 0) {
    return jsonError(503, 'No accounts configured');
  }

  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const bodyBuf = hasBody ? await req.arrayBuffer() : undefined;

  const upstreamUrl = buildUpstreamUrl(req.url);

  // 清理请求头：去掉 hop-by-hop + 客户端的 Authorization（用自己的）
  const baseHeaders = {};
  for (const [k, v] of req.headers) {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    if (lk === 'authorization') continue; // 不透传客户端凭据
    baseHeaders[k] = v;
  }

  /** @type {{status:number, reason:string, body:string, account:string}[]} */
  const tried = [];

  for (const acc of accountManager.pick(config.maxRetries || undefined)) {
    const headers = {
      ...baseHeaders,
      authorization: `Bearer ${acc.apiKey}`,
    };

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method,
        headers,
        body: bodyBuf,
        duplex: 'half',
      });
    } catch (e) {
      accountManager.reportFailure(acc, 'serverError', `fetch error: ${e.message}`);
      tried.push({ status: 0, reason: 'fetchError', body: e.message, account: acc.account });
      continue;
    }

    if (upstream.ok) {
      accountManager.reportSuccess(acc);
      return passthroughResponse(upstream, acc.account);
    }

    const bodyText = await readErrorBody(upstream);
    const cls = classifyFailure(upstream.status, bodyText);
    accountManager.reportFailure(acc, cls.reason, `${upstream.status}: ${bodyText.slice(0, 160)}`);
    tried.push({ status: upstream.status, reason: cls.reason, body: bodyText, account: acc.account });

    if (!cls.retryable) {
      return rebuildResponse(upstream.status, upstream.headers, bodyText, acc.account);
    }
  }

  if (tried.length === 0) {
    return jsonError(503, 'All accounts are cooling down', { tried });
  }
  const last = tried[tried.length - 1];
  return jsonError(
    last.status >= 400 && last.status < 600 ? last.status : 502,
    `Upstream failed on all ${tried.length} account(s): ${last.reason}`,
    { tried: tried.map((t) => ({ account: t.account, status: t.status, reason: t.reason })) },
  );
}

function passthroughResponse(upstream, accountTag) {
  const headers = new Headers();
  for (const [k, v] of upstream.headers) {
    if (RESP_STRIP.has(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  headers.set('x-served-by-account', accountTag);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function rebuildResponse(status, srcHeaders, bodyText, accountTag) {
  const headers = new Headers();
  for (const [k, v] of srcHeaders) {
    if (RESP_STRIP.has(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  headers.set('x-served-by-account', accountTag);
  return new Response(bodyText, { status, headers });
}

function jsonError(status, message, extra) {
  return new Response(JSON.stringify({ error: { message, ...extra } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
