import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs';

// 简易 .env 解析
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, rawV] = m;
    if (process.env[k] !== undefined) continue;
    let v = rawV;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

const num = (v, dft) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dft;
};

export const config = {
  port: num(process.env.PORT, 18002),
  host: process.env.HOST || '0.0.0.0',
  accountsFile: path.resolve(process.cwd(), process.env.ACCOUNTS_FILE || './accounts.json'),
  upstream: (process.env.UPSTREAM || 'https://cc.freemodel.dev').replace(/\/+$/, ''),
  accessToken: process.env.ACCESS_TOKEN || '',
  maxRetries: process.env.MAX_RETRIES ? num(process.env.MAX_RETRIES, 0) : 0,
  cooldown: {
    rateLimit: num(process.env.COOLDOWN_RATE_LIMIT_MS, 60_000),
    quota: num(process.env.COOLDOWN_QUOTA_MS, 3_600_000),
    serverError: num(process.env.COOLDOWN_SERVER_ERROR_MS, 10_000),
  },
};
