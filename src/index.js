import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { settings } from './config.js';
import { pool } from './accountManager.js';
import { relay } from './forwarder.js';
import { listModels, getModel } from './models.js';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, tokens: pool.count() }));
app.get('/status', (c) => c.json({ tokens: pool.snapshot() }));

app.get('/', (c) =>
  c.json({
    name: 'freemodel-proxy',
    upstreams: {
      anthropic: settings.upstreamAnthropic,
      openai: settings.upstreamOpenAI,
    },
    routes: ['/v1/messages', '/messages', '/v1/chat/completions', '/v1/responses', '/v1/models', '/models'],
    tokens: pool.count(),
  }),
);

// 自定义 fetch：gate + 路由分发，绕过 Hono 中间件以避免流式响应内部状态错误
const honoFetch = app.fetch;
const customFetch = async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Gate
  if (settings.gateToken && pathname !== '/health' && pathname !== '/status') {
    const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const passed = bearer === settings.gateToken;
    console.log(`[gate] ${req.method} ${pathname} auth=${passed ? 'ok' : 'DENY'} token=${bearer ? '***' + bearer.slice(-4) : '<none>'}`);
    if (!passed) {
      return new Response(JSON.stringify({ error: { message: 'unauthorized' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  // /models /v1/models
  if (req.method === 'GET' && (pathname === '/models' || pathname === '/v1/models')) {
    return new Response(JSON.stringify(await listModels()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  // /v1/models/:id
  const modelIdMatch = pathname.match(/^\/v1\/models\/(.+)$/);
  if (req.method === 'GET' && modelIdMatch) {
    const m = await getModel(modelIdMatch[1]);
    if (!m) {
      return new Response(JSON.stringify({ error: { message: `unknown model: ${modelIdMatch[1]}` } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(m), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  // Relay: /v1/* (except /v1/models), /messages
  if (pathname === '/messages' || (pathname.startsWith('/v1/') && !pathname.startsWith('/v1/models'))) {
    return relay(req);
  }

  // Fallback to Hono (/, /health, /status)
  return honoFetch(req);
};

const srv = serve({ fetch: customFetch, port: settings.port, hostname: settings.host }, (info) => {
  console.log(`freemodel-proxy → ${info.address}:${info.port}`);
  console.log(`  anthropic: ${settings.upstreamAnthropic}`);
  console.log(`  openai:    ${settings.upstreamOpenAI}`);
  console.log(`  gate: ${settings.gateToken ? 'on' : 'off (open)'}`);
});

const stop = (sig) => {
  console.log(`\n[${sig}] shutdown`);
  srv.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => stop(s)));
