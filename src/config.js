import fs from 'node:fs';
import path from 'node:path';
import { normalizeAccountSelectionMode } from './accountSelection.js';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, val] = m;
    if (process.env[key] !== undefined) continue;
    let v = val.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[key] = v;
  }
}

const int = (s, d) => (Number.isFinite(Number(s)) ? Number(s) : d);
const accountsPath = path.resolve(process.cwd(), process.env.ACCOUNTS_FILE || './accounts.json');

export const settings = {
  port: int(process.env.PORT, 18002),
  host: process.env.HOST || '0.0.0.0',
  accountsPath,
  tokenStatePath: path.resolve(process.cwd(), process.env.TOKEN_STATE_FILE || path.join(path.dirname(accountsPath), 'token-state.json')),
  accountSelectionMode: normalizeAccountSelectionMode(process.env.ACCOUNT_SELECTION_MODE || 'sticky'),
  // Anthropic Messages → cc.freemodel.dev
  upstreamAnthropic: (process.env.UPSTREAM_ANTHROPIC || 'https://cc.freemodel.dev').replace(/\/+$/, ''),
  // OpenAI Chat / Responses → api.freemodel.dev
  upstreamOpenAI: (process.env.UPSTREAM_OPENAI || 'https://api.freemodel.dev').replace(/\/+$/, ''),
  gateToken: process.env.ACCESS_TOKEN || '',
  maxAttempts: int(process.env.MAX_RETRIES, 0),
  cooldown: {
    rateLimit: int(process.env.COOLDOWN_RATE_LIMIT_MS, 60000),
    quota: int(process.env.COOLDOWN_QUOTA_MS, 18000000),
    serverError: int(process.env.COOLDOWN_SERVER_ERROR_MS, 10000),
  },
};
