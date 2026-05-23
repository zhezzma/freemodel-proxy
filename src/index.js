import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { settings } from './config.js';
import { pool } from './accountManager.js';
import { relay } from './forwarder.js';
import { listModels, getModel } from './models.js';

const app = new Hono();

// Gate
app.use('*', async (c, next) => {
  if (!settings.gateToken) return next();
  if (c.req.path === '/health' || c.req.path === '/status') return next();
  const bearer = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '');
  if (bearer === settings.gateToken) return next();
  return c.json({ error: { message: 'unauthorized' } }, 401);
});

app.get('/health', (c) => c.json({ ok: true, tokens: pool.count() }));
app.get('/status', (c) => c.json({ tokens: pool.snapshot() }));

// Model list — cache & serve
const modelsOut = async (c) => c.json(await listModels());
const modelOut = async (c) => {
  const m = await getModel(c.req.param('id'));
  return m ? c.json(m) : c.json({ error: { message: `unknown model: ${c.req.param('id')}` } }, 404);
};
app.get('/models', modelsOut);
app.get('/v1/models', modelsOut);
app.get('/v1/models/:id', modelOut);

// Transparent relay: Anthropic Messages, OpenAI Chat, OpenAI Responses, Codex, etc.
app.all('/v1/*', (c) => relay(c.req.raw));
app.all('/messages', (c) => relay(c.req.raw));

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

const srv = serve({ fetch: app.fetch, port: settings.port, hostname: settings.host }, (info) => {
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
