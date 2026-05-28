import { settings } from './config.js';
import { pool } from './accountManager.js';
import { diagnoseUpstreamFailure } from './quota.js';

const STRIP_REQ = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'host', 'content-length', 'accept-encoding',
]);

const STRIP_RES = new Set([
  'transfer-encoding', 'connection', 'keep-alive',
  'content-encoding', 'content-length',
]);

// --- Anthropic Messages 专用常量 ---
const DEVICE_ID = 'a225c51dcb1945c1575dc6d055fe0a24f6c45a3f2f1c6ca6de67a5a3eccff067';
const ANTHROPIC_BETA =
  'claude-code-20250219,context-1m-2025-08-07,interleaved-thinking-2025-05-14,redact-thinking-2026-02-12,context-management-2025-06-27,prompt-caching-scope-2026-01-05,effort-2025-11-24';

function uuid() { return crypto.randomUUID(); }

/** 根据路径选择上游：Anthropic Messages → cc, OpenAI → api */
function upstreamTarget(clientUrl, isAnthropic) {
  const u = new URL(clientUrl);
  let qs = u.search;
  const base = isAnthropic ? settings.upstreamAnthropic : settings.upstreamOpenAI;
  if (isAnthropic) {
    qs = qs ? `${qs}&beta=true` : '?beta=true';
  }
  return `${base}${u.pathname}${qs}`;
}

async function drainBody(res) {
  try { return new TextDecoder().decode(await res.arrayBuffer()); } catch { return ''; }
}

/** 判断是否为 Anthropic Messages 端点 */
function isAnthropicMessages(pathname) {
  return pathname === '/v1/messages' || pathname === '/messages';
}

/** 为 Anthropic Messages 请求注入必要的 headers 和 body 字段 */
function buildAnthropicRequest(originalBody, apiKey) {
  const sid = uuid();
  const bodyObj = typeof originalBody === 'string' ? JSON.parse(originalBody) : originalBody;

  // 注入 system prompt
  const existingSystem = Array.isArray(bodyObj.system)
    ? bodyObj.system
    : typeof bodyObj.system === 'string'
      ? [{ type: 'text', text: bodyObj.system }]
      : [];

  const enrichedBody = {
    ...bodyObj,
    system: [
      {
        type: 'text',
        text: `x-anthropic-billing-header: cc_version=2.2.126.507; cc_entrypoint=cli; cch=00a69;`,
      },
      {
        type: 'text',
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        cache_control: { type: 'ephemeral' },
      },
      ...existingSystem,
    ],
    metadata: {
      user_id: JSON.stringify({
        device_id: DEVICE_ID,
        account_uuid: '',
        session_id: sid,
      }),
    },
  };
  delete enrichedBody.context_management;

  const headers = {
    'accept': 'application/json',
    'content-type': 'application/json',
    'authorization': `Bearer ${apiKey}`,
    'user-agent': 'claude-cli/2.2.126 (external, cli)',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': ANTHROPIC_BETA,
    'anthropic-dangerous-direct-browser-access': 'true',
    'x-app': 'cli',
    'x-claude-code-session-id': sid,
    'x-stainless-arch': 'x64',
    'x-stainless-lang': 'js',
    'x-stainless-os': 'Linux',
    'x-stainless-package-version': '0.81.0',
    'x-stainless-retry-count': '0',
    'x-stainless-runtime': 'node',
    'x-stainless-runtime-version': 'v24.3.0',
    'x-stainless-timeout': '600',
    'connection': 'keep-alive',
  };

  return { body: JSON.stringify(enrichedBody), headers };
}

/**
 * 透明转发 + 多 token 轮转
 *   - /v1/messages → Anthropic 专用 headers + body 注入
 *   - /v1/chat/completions、/v1/responses → 透明转发（仅替换 Bearer token）
 */
export async function relay(req) {
  if (pool.count() === 0) {
    return Response.json({ error: { message: 'no tokens configured' } }, { status: 503 });
  }

  const url = new URL(req.url);
  const anthropic = isAnthropicMessages(url.pathname);
  const method = req.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let rawBody;
  if (hasBody) {
    const buf = await req.arrayBuffer();
    rawBody = buf.byteLength > 0 ? new TextDecoder().decode(buf) : undefined;
  }

  const target = upstreamTarget(req.url, anthropic);

  // 清理客户端 headers
  const keepHeaders = {};
  for (const [k, v] of req.headers) {
    const lk = k.toLowerCase();
    if (STRIP_REQ.has(lk)) continue;
    if (lk === 'authorization') continue;
    keepHeaders[k] = v;
  }

  const attempts = [];

  for (const entry of pool.next(settings.maxAttempts || undefined)) {
    const requestStartedAt = Date.now();
    let reqInit;
    if (anthropic && rawBody) {
      const enriched = buildAnthropicRequest(rawBody, entry.token);
      reqInit = {
        method,
        headers: enriched.headers,
        body: enriched.body,
      };
    } else {
      reqInit = {
        method,
        headers: {
          ...keepHeaders,
          authorization: `Bearer ${entry.token}`,
        },
        body: rawBody || undefined,
      };
    }

    // 非流式/小请求用 duplex: 'half' 兼容 Node fetch
    if (reqInit.body) reqInit.duplex = 'half';

    console.log(`[relay] → ${entry.email} ${method} ${url.pathname}`);

    let upstream;
    try {
      upstream = await fetch(target, reqInit);
    } catch (err) {
      console.error(`[relay] ✗ ${entry.email} fetch error: ${err.message}`);
      pool.markFail(entry, 'srv', `fetch: ${err.message}`);
      attempts.push({ email: entry.email, status: 0, cause: 'fetchErr', detail: err.message });
      continue;
    }

    // 打印上游响应状态和关键 header
    const respHeaders = {};
    for (const [k, v] of upstream.headers) {
      const lk = k.toLowerCase();
      if (['content-type', 'x-request-id', 'retry-after', 'x-ratelimit', 'anthropic-ratelimit'].some(prefix => lk.startsWith(prefix))) {
        respHeaders[k] = v;
      }
    }

    if (upstream.ok) {
      pool.markOk(entry, requestStartedAt);
      console.log(`[relay] ✓ ${entry.email} ${upstream.status} ${JSON.stringify(respHeaders)}`);
      return streamBack(upstream, entry.email);
    }

    const errBody = await drainBody(upstream);
    console.error(`[relay] ✗ ${entry.email} ${upstream.status} headers=${JSON.stringify(respHeaders)} body=${errBody.slice(0, 300)}`);
    const diag = diagnoseUpstreamFailure(upstream.status, errBody);
    pool.markFail(entry, diag.cause, `${upstream.status}: ${errBody.slice(0, 160)}`, diag.freezeMs);
    attempts.push({ email: entry.email, status: upstream.status, cause: diag.cause, detail: errBody });

    if (!diag.retry) {
      return echoResponse(upstream.status, upstream.headers, errBody, entry.email);
    }
  }

  if (attempts.length === 0) {
    return Response.json({ error: { message: 'all tokens frozen' } }, { status: 503 });
  }
  const last = attempts[attempts.length - 1];
  return Response.json({
    error: {
      message: `exhausted ${attempts.length} token(s): ${last.cause}`,
      attempts: attempts.map((a) => ({ email: a.email, status: a.status, cause: a.cause })),
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
