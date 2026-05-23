import fs from 'node:fs';
import { settings } from './config.js';

class TokenPool {
  #entries = [];
  #idx = 0;
  #mtime = 0;

  constructor() {
    this.#reload();
    try {
      fs.watch(settings.accountsPath, { persistent: false }, () => {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this.#reload(), 200);
      });
    } catch {
      // fs.watch may not be available
    }
  }

  #reload() {
    let raw;
    try {
      const stat = fs.statSync(settings.accountsPath);
      if (stat.mtimeMs === this.#mtime) return;
      this.#mtime = stat.mtimeMs;
      raw = fs.readFileSync(settings.accountsPath, 'utf8');
    } catch {
      return;
    }
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(data)) return;

    const old = new Map(this.#entries.map((e) => [e.token, e]));
    this.#entries = data
      .filter((d) => d && typeof d.token === 'string' && d.token.length > 0)
      .map((d) => {
        const prev = old.get(d.token);
        return {
          label: d.label || d.account || '<anon>',
          token: d.token,
          disabled: !!d.disabled,
          frozenUntil: prev?.frozenUntil ?? 0,
          lastErr: prev?.lastErr,
          ok: prev?.ok ?? 0,
          fail: prev?.fail ?? 0,
        };
      });
    if (this.#idx >= this.#entries.length) this.#idx = 0;
    const on = this.#entries.filter((e) => !e.disabled).length;
    console.log(`[pool] loaded ${this.#entries.length} tokens (${on} active / ${this.#entries.length - on} disabled)`);
  }

  count() { return this.#entries.length; }

  /** round-robin iterator over available tokens */
  *next(limit) {
    const n = this.#entries.length;
    if (n === 0) return;
    const cap = limit && limit > 0 ? Math.min(limit, n) : n;
    const now = Date.now();
    const start = this.#idx % n;
    this.#idx = (this.#idx + 1) % n;
    let y = 0;
    for (let s = 0; s < n && y < cap; s++) {
      const e = this.#entries[(start + s) % n];
      if (e.disabled || e.frozenUntil > now) continue;
      y++;
      yield e;
    }
  }

  markOk(e) { e.ok++; e.frozenUntil = 0; e.lastErr = undefined; }

  markFail(e, cause, msg) {
    e.fail++;
    e.lastErr = String(msg || '').slice(0, 200);
    let ms = 0;
    if (cause === 'rate') ms = settings.cooldown.rateLimit;
    else if (cause === 'quota' || cause === 'perm') ms = settings.cooldown.quota;
    else if (cause === 'srv') ms = settings.cooldown.serverError;
    if (ms > 0) e.frozenUntil = Date.now() + ms;
    console.warn(`[pool] ${e.label} fail (${cause})${ms ? ` freeze ${Math.round(ms / 1000)}s` : ''}: ${e.lastErr || ''}`);
  }

  snapshot() {
    const now = Date.now();
    return this.#entries.map((e) => ({
      label: e.label,
      tokenTail: '***' + e.token.slice(-4),
      disabled: e.disabled,
      ok: e.ok,
      fail: e.fail,
      freezeLeftMs: Math.max(0, e.frozenUntil - now),
      lastErr: e.lastErr,
    }));
  }
}

export const pool = new TokenPool();
