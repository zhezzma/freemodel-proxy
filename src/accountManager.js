import fs from 'node:fs';
import { config } from './config.js';

/**
 * @typedef {Object} Account
 * @property {string}  account       标识
 * @property {string}  apiKey        API Key（用作 Bearer token）
 * @property {boolean} [disabled]
 * @property {number}  cooldownUntil 冷却结束时间戳（ms）
 * @property {string}  [lastError]
 * @property {number}  successCount
 * @property {number}  failureCount
 */

class AccountManager {
  /** @type {Account[]} */
  #accounts = [];
  #cursor = 0;
  #fileMTime = 0;

  constructor() {
    this.reload();
    try {
      fs.watch(config.accountsFile, { persistent: false }, () => {
        clearTimeout(this._t);
        this._t = setTimeout(() => this.reload(), 200);
      });
    } catch (e) {
      console.warn(`[accounts] fs.watch 不可用: ${e.message}`);
    }
  }

  reload() {
    let raw;
    try {
      const stat = fs.statSync(config.accountsFile);
      if (stat.mtimeMs === this.#fileMTime) return;
      this.#fileMTime = stat.mtimeMs;
      raw = fs.readFileSync(config.accountsFile, 'utf8');
    } catch (e) {
      console.error(`[accounts] 无法读取 ${config.accountsFile}: ${e.message}`);
      return;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      console.error(`[accounts] JSON 解析失败: ${e.message}`);
      return;
    }
    if (!Array.isArray(data)) {
      console.error('[accounts] accounts.json 必须是数组');
      return;
    }

    const prev = new Map(this.#accounts.map((a) => [a.apiKey, a]));
    this.#accounts = data
      .filter((a) => a && typeof a.apiKey === 'string' && a.apiKey.length > 0)
      .map((a) => {
        const old = prev.get(a.apiKey);
        return {
          account: a.account || '<anonymous>',
          apiKey: a.apiKey,
          disabled: !!a.disabled,
          cooldownUntil: old?.cooldownUntil ?? 0,
          lastError: old?.lastError,
          successCount: old?.successCount ?? 0,
          failureCount: old?.failureCount ?? 0,
        };
      });
    if (this.#cursor >= this.#accounts.length) this.#cursor = 0;
    const enabled = this.#accounts.filter((a) => !a.disabled).length;
    console.log(
      `[accounts] 已加载 ${this.#accounts.length} 个账号（启用 ${enabled} / 禁用 ${this.#accounts.length - enabled}）`,
    );
  }

  size() {
    return this.#accounts.length;
  }

  /**
   * Round-robin 迭代器，跳过冷却中/禁用的账号
   * @param {number} [limit]
   */
  *pick(limit) {
    const n = this.#accounts.length;
    if (n === 0) return;
    const cap = limit && limit > 0 ? Math.min(limit, n) : n;
    const now = Date.now();
    const start = this.#cursor % n;
    this.#cursor = (this.#cursor + 1) % n;

    let yielded = 0;
    for (let step = 0; step < n && yielded < cap; step++) {
      const acc = this.#accounts[(start + step) % n];
      if (acc.disabled) continue;
      if (acc.cooldownUntil > now) continue;
      yielded++;
      yield acc;
    }
  }

  reportSuccess(acc) {
    acc.successCount++;
    acc.cooldownUntil = 0;
    acc.lastError = undefined;
  }

  reportFailure(acc, reason, message) {
    acc.failureCount++;
    acc.lastError = message?.slice(0, 200);
    const now = Date.now();
    let ms = 0;
    switch (reason) {
      case 'rateLimit':
        ms = config.cooldown.rateLimit;
        break;
      case 'quota':
      case 'permission':
        ms = config.cooldown.quota;
        break;
      case 'serverError':
        ms = config.cooldown.serverError;
        break;
      default:
        ms = 0;
    }
    if (ms > 0) acc.cooldownUntil = now + ms;
    console.warn(
      `[accounts] ${acc.account} 失败(${reason})${ms ? ` 冷却 ${Math.round(ms / 1000)}s` : ''}: ${acc.lastError || ''}`,
    );
  }

  snapshot() {
    const now = Date.now();
    return this.#accounts.map((a) => ({
      account: a.account,
      apiKeyTail: '***' + a.apiKey.slice(-4),
      disabled: a.disabled,
      successCount: a.successCount,
      failureCount: a.failureCount,
      cooldownRemainingMs: Math.max(0, a.cooldownUntil - now),
      lastError: a.lastError,
    }));
  }
}

export const accountManager = new AccountManager();
