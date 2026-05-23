import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { config } from './config.js';
import { accountManager } from './accountManager.js';
import { forward } from './forwarder.js';
import { listModels, retrieveModel } from './models.js';

const app = new Hono();

// 访问鉴权
app.use('*', async (c, next) => {
  if (!config.accessToken) return next();
  if (c.req.path === '/health' || c.req.path === '/status') return next();

  const auth = c.req.header('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (bearer === config.accessToken) return next();
  return c.json({ error: { message: 'Unauthorized' } }, 401);
});

app.get('/health', (c) => c.json({ status: 'ok', accounts: accountManager.size() }));

app.get('/status', (c) => c.json({ accounts: accountManager.snapshot() }));

// 模型列表：缓存上游 /v1/models（OpenAI 格式）
// 必须在 catch-all 之前注册
const modelHandler = async (c) => c.json(await listModels());
const modelByIdHandler = async (c) => {
  const m = await retrieveModel(c.req.param('id'));
  if (!m) return c.json({ error: { message: `model not found: ${c.req.param('id')}` } }, 404);
  return c.json(m);
};
app.get('/models', modelHandler);
app.get('/v1/models', modelHandler);
app.get('/v1/models/:id', modelByIdHandler);

// 透明转发：Anthropic Messages、OpenAI Chat Completions、OpenAI Responses 等
// /v1/messages       → Anthropic 原生 Messages（Claude Code / Cline）
// /v1/chat/completions → OpenAI 兼容对话补全
// /v1/responses      → OpenAI Responses（有状态多轮）
// 其他 /v1/*         → 兜底转发
app.all('/v1/*', (c) => forward(c.req.raw));

app.get('/', (c) =>
  c.json({
    name: 'freemodel-proxy',
    upstream: config.upstream,
    endpoints: [
      '/v1/messages',
      '/v1/chat/completions',
      '/v1/responses',
      '/v1/models',
      '/models',
      '/health',
      '/status',
    ],
    accounts: accountManager.size(),
  }),
);

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  ({ address, port }) => {
    console.log(`🚀 freemodel-proxy listening on http://${address}:${port}`);
    console.log(`🔁 upstream: ${config.upstream}`);
    console.log(`🔐 access token: ${config.accessToken ? 'enabled' : 'disabled (open)'}`);
  },
);

const shutdown = (sig) => {
  console.log(`\n[${sig}] shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
