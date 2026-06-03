const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function messageText(body) {
  if (!body) return '';
  try {
    const data = JSON.parse(body);
    if (typeof data === 'string') return data;
    if (typeof data?.error === 'string') return data.error;
    if (typeof data?.error?.message === 'string') return data.error.message;
    if (typeof data?.message === 'string') return data.message;
  } catch {
    // 非 JSON 响应仍按原文做关键词/时间提取。
  }
  return String(body);
}

function beijingParts(date) {
  const shifted = new Date(date.getTime() + BEIJING_UTC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function beijingDateToUtcMs(year, month, day, hour, minute) {
  return Date.UTC(year, month, day, hour, minute) - BEIJING_UTC_OFFSET_MS;
}

function normalizeHour(text, rawHour) {
  let hour = Number(rawHour);
  const has = (period) => new RegExp(`${period}\\s*${rawHour}\\s*[点:]`).test(text);

  // 中文 12 点边界：上午/凌晨 12 点是 00:xx，中午/下午 12 点是 12:xx，晚上 12 点是次日 00:xx。
  if ((has('凌晨') || has('上午')) && hour === 12) return 0;
  if (has('晚上') && hour === 12) return 24;
  if (has('中午') && hour > 0 && hour < 12) return hour + 12;
  if ((has('下午') || has('晚上')) && hour < 12) return hour + 12;
  return hour;
}

const ENGLISH_MONTHS = new Map([
  ['jan', 0], ['january', 0],
  ['feb', 1], ['february', 1],
  ['mar', 2], ['march', 2],
  ['apr', 3], ['april', 3],
  ['may', 4],
  ['jun', 5], ['june', 5],
  ['jul', 6], ['july', 6],
  ['aug', 7], ['august', 7],
  ['sep', 8], ['sept', 8], ['september', 8],
  ['oct', 9], ['october', 9],
  ['nov', 10], ['november', 10],
  ['dec', 11], ['december', 11],
]);

function englishHour(rawHour, ampm) {
  let hour = Number(rawHour);
  if (ampm.toUpperCase() === 'PM' && hour < 12) hour += 12;
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
  return hour;
}

function englishResetDeltaMs(resetAt, now) {
  if (resetAt <= now.getTime() && now.getTime() < resetAt + 60_000) {
    return resetAt + 60_000 - now.getTime();
  }
  return Math.max(0, resetAt - now.getTime());
}

function parseEnglishResetMs(text, now = new Date()) {
  // "will reset on today at 2:51 PM (UTC+8)" / "will reset on tomorrow at 10:32 AM (UTC+8)"
  const relative = text.match(/will reset (?:on\s+)?(today|tomorrow)\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(UTC\+8\)/i);
  if (relative) {
    const [, dayWord, rawHour, rawMinute, ampm] = relative;
    const nowBjt = beijingParts(now);
    const targetDay = nowBjt.day + (dayWord.toLowerCase() === 'tomorrow' ? 1 : 0);
    const resetAt = beijingDateToUtcMs(nowBjt.year, nowBjt.month, targetDay, englishHour(rawHour, ampm), Number(rawMinute));
    return englishResetDeltaMs(resetAt, now);
  }

  // "will reset on Jun 3 at 4:58 PM (UTC+8)"
  const monthDay = text.match(/will reset on\s+([A-Z][a-z]+)\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(UTC\+8\)/i);
  if (!monthDay) return undefined;

  const [, rawMonth, rawDay, rawHour, rawMinute, ampm] = monthDay;
  const targetMonth = ENGLISH_MONTHS.get(rawMonth.toLowerCase());
  if (targetMonth === undefined) return undefined;

  const nowBjt = beijingParts(now);
  const targetDay = Number(rawDay);
  const hour = englishHour(rawHour, ampm);
  const minute = Number(rawMinute);
  let resetAt = beijingDateToUtcMs(nowBjt.year, targetMonth, targetDay, hour, minute);
  if (now.getTime() >= resetAt + 60_000) {
    resetAt = beijingDateToUtcMs(nowBjt.year + 1, targetMonth, targetDay, hour, minute);
  }
  return englishResetDeltaMs(resetAt, now);
}

function parseChineseResetMs(text, now = new Date()) {
  // 先尝试英文格式
  const enMs = parseEnglishResetMs(text, now);
  if (enMs !== undefined) return enMs;

  const hourMinuteRelative = text.match(/(?:(\d+)\s*小时)?\s*(?:(\d+)\s*分钟)?后(?:重置|恢复)?/);
  if (hourMinuteRelative && (hourMinuteRelative[1] || hourMinuteRelative[2])) {
    const hours = Number(hourMinuteRelative[1] || 0);
    const minutes = Number(hourMinuteRelative[2] || 0);
    return ((hours * 60) + minutes) * 60 * 1000;
  }

  const nowBjt = beijingParts(now);
  const weekday = text.match(/周([一二三四五六日天])\s*(?:凌晨|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[点:]\s*(\d{1,2})\s*分?/);
  if (weekday) {
    const weekdayMap = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    const currentDow = new Date(now.getTime() + BEIJING_UTC_OFFSET_MS).getUTCDay();
    const targetDow = weekdayMap[weekday[1]];
    let daysAhead = (targetDow - currentDow + 7) % 7;
    const hour = normalizeHour(text, weekday[2]);
    const minute = Number(weekday[3]);
    let resetAt = beijingDateToUtcMs(nowBjt.year, nowBjt.month, nowBjt.day + daysAhead, hour, minute);
    if (daysAhead === 0 && resetAt <= now.getTime()) {
      daysAhead = 7;
      resetAt = beijingDateToUtcMs(nowBjt.year, nowBjt.month, nowBjt.day + daysAhead, hour, minute);
    }
    return Math.max(0, resetAt - now.getTime());
  }

  const monthDay = text.match(/将[于在]\s*(\d{1,2})月(\d{1,2})日\s*(?:凌晨|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[点:]\s*(\d{1,2})\s*分?/);
  if (monthDay) {
    const targetMonth = Number(monthDay[1]) - 1;
    const targetDay = Number(monthDay[2]);
    const hour = normalizeHour(text, monthDay[3]);
    const minute = Number(monthDay[4]);
    let resetAt = beijingDateToUtcMs(nowBjt.year, targetMonth, targetDay, hour, minute);
    if (resetAt <= now.getTime()) {
      resetAt = beijingDateToUtcMs(nowBjt.year + 1, targetMonth, targetDay, hour, minute);
    }
    return Math.max(0, resetAt - now.getTime());
  }

  const absolute = text.match(/将[于在]\s*(明天|今天)?\s*(?:凌晨|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[点:]\s*(\d{1,2})\s*分?/);
  if (!absolute) return undefined;

  const [, dayWord, rawHour, rawMinute] = absolute;
  const targetDay = nowBjt.day + (dayWord === '明天' ? 1 : 0);
  const hour = normalizeHour(text, rawHour);
  const minute = Number(rawMinute);

  let resetAt = beijingDateToUtcMs(nowBjt.year, nowBjt.month, targetDay, hour, minute);
  if (!dayWord && resetAt <= now.getTime()) {
    resetAt = beijingDateToUtcMs(nowBjt.year, nowBjt.month, targetDay + 1, hour, minute);
  }

  return Math.max(0, resetAt - now.getTime());
}

export function resolveFailureFreezeMs(cause, cooldown, upstreamFreezeMs) {
  // 显式冻结时长优先（如 quota 从上游响应解析出的重置时间）。
  if (Number.isFinite(upstreamFreezeMs) && upstreamFreezeMs > 0) return upstreamFreezeMs;
  if (cause === 'quota') return cooldown.quota;
  if (cause === 'incompat') return cooldown.incompat;
  return 0;
}

export function diagnoseUpstreamFailure(status, body, now = new Date()) {
  const text = messageText(body);
  if (status === 429) return { retry: true, cause: 'rate' };
  if (status === 402) return { retry: true, cause: 'quota', freezeMs: parseChineseResetMs(text, now) };
  if (status === 403) {
    const quota = /quota|exceed|insufficient|limit|限额|上限|用量|额度|耗尽/i.test(text);
    return { retry: true, cause: quota ? 'quota' : 'perm', freezeMs: quota ? parseChineseResetMs(text, now) : undefined };
  }
  if (status === 401) return { retry: true, cause: 'perm' };
  if (status === 305) return { retry: true, cause: 'srv' };
  if (status >= 500) return { retry: true, cause: 'srv' };

  // thinking 多轮（带 tool_use）请求打到严格的 DeepSeek 套壳后端时，会要求回传
  // 上一轮的 thinking 块；部分账号 key 未开通 Anthropic 端点。这两类 400 都是
  // 后端能力/路由问题，同一请求换个账号大概率能成功，故标为可重试并冻结该账号。
  if (/content\[\]\.thinking|must be passed back|unsupported_client|not supported on this endpoint/i.test(text)) {
    return { retry: true, cause: 'incompat' };
  }

  return { retry: false, cause: 'badreq' };
}
