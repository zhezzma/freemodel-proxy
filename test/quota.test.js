import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseUpstreamFailure, resolveFailureFreezeMs } from '../src/quota.js';

test('diagnoses upstream 402 usage limit as quota exhaustion', () => {
  const result = diagnoseUpstreamFailure(402, '{"error":"已达到用量上限，将在明天凌晨12点19分（北京时间）恢复"}');

  assert.equal(result.retry, true);
  assert.equal(result.cause, 'quota');
});

test('extracts Beijing reset time from Chinese quota message', () => {
  const now = new Date('2026-05-26T15:20:00.000Z'); // 北京时间 2026-05-26 23:20
  const result = diagnoseUpstreamFailure(
    402,
    '{"error":"已达到用量上限，将在明天凌晨12点19分（北京时间）恢复"}',
    now,
  );

  assert.equal(result.retry, true);
  assert.equal(result.cause, 'quota');
  assert.equal(result.freezeMs, 59 * 60 * 1000);
});

test('uses upstream reset freeze over fixed quota cooldown', () => {
  const cooldown = { rateLimit: 60_000, quota: 3_600_000, serverError: 10_000 };

  assert.equal(resolveFailureFreezeMs('quota', cooldown, 59 * 60 * 1000), 59 * 60 * 1000);
});

test('extracts hour-minute relative reset time from Chinese quota message', () => {
  const result = diagnoseUpstreamFailure(402, '{"error":"已达限额，3小时58分钟后重置"}');

  assert.equal(result.cause, 'quota');
  assert.equal(result.freezeMs, ((3 * 60) + 58) * 60 * 1000);
});

test('extracts Beijing weekday reset time from Chinese quota message', () => {
  const now = new Date('2026-05-26T04:47:00.000Z'); // 周二，北京时间 12:47
  const result = diagnoseUpstreamFailure(402, '{"error":"已达限额，将于 周一12:47 重置"}', now);

  assert.equal(result.cause, 'quota');
  assert.equal(result.freezeMs, 6 * 24 * 60 * 60 * 1000);
});

test('extracts Beijing month-day reset time from Chinese quota message', () => {
  const now = new Date('2026-05-26T04:32:00.000Z'); // 北京时间 5月26日 12:32
  const result = diagnoseUpstreamFailure(402, '{"error":"已达到用量上限，将在5月30日上午10点32分（北京时间）恢复"}', now);

  assert.equal(result.cause, 'quota');
  assert.equal(result.freezeMs, ((3 * 24) + 22) * 60 * 60 * 1000);
});

test('does not retry unknown client errors across tokens', () => {
  const result = diagnoseUpstreamFailure(400, '{"error":"bad request"}');

  assert.equal(result.retry, false);
  assert.equal(result.cause, 'badreq');
});

test('only quota failures produce a freeze duration', () => {
  const cooldown = { rateLimit: 60_000, quota: 3_600_000, serverError: 10_000 };

  assert.equal(resolveFailureFreezeMs('quota', cooldown, 123_000), 123_000);
  assert.equal(resolveFailureFreezeMs('quota', cooldown, undefined), 3_600_000);
  assert.equal(resolveFailureFreezeMs('perm', cooldown, undefined), 0);
  assert.equal(resolveFailureFreezeMs('srv', cooldown, undefined), 0);
  assert.equal(resolveFailureFreezeMs('rate', cooldown, undefined), 0);
  assert.equal(resolveFailureFreezeMs('badreq', cooldown, undefined), 0);
});

test('detects Chinese quota exhaustion text in 403 responses', () => {
  const now = new Date('2026-05-26T16:09:00.000Z'); // 北京时间 2026-05-27 00:09
  const result = diagnoseUpstreamFailure(403, '{"error":"额度耗尽，将在今天凌晨12点19分恢复"}', now);

  assert.equal(result.cause, 'quota');
  assert.equal(result.freezeMs, 10 * 60 * 1000);
});

test('handles today midnight reset time', () => {
  const now = new Date('2026-05-26T16:09:00.000Z'); // 北京时间 2026-05-27 00:09
  const result = diagnoseUpstreamFailure(402, '{"error":"已达到用量上限，将在今天凌晨12点19分（北京时间）恢复"}', now);

  assert.equal(result.cause, 'quota');
  assert.equal(result.freezeMs, 10 * 60 * 1000);
});

test('handles Chinese day-period 12 oclock boundaries', () => {
  const now = new Date('2026-05-26T01:00:00.000Z'); // 北京时间 09:00

  assert.equal(
    diagnoseUpstreamFailure(402, '{"error":"将在今天中午12点00分恢复"}', now).freezeMs,
    3 * 60 * 60 * 1000,
  );
  assert.equal(
    diagnoseUpstreamFailure(402, '{"error":"将在今天下午12点00分恢复"}', now).freezeMs,
    3 * 60 * 60 * 1000,
  );
  assert.equal(
    diagnoseUpstreamFailure(402, '{"error":"将在今天晚上12点00分恢复"}', now).freezeMs,
    15 * 60 * 60 * 1000,
  );
  assert.equal(
    diagnoseUpstreamFailure(402, '{"error":"将在明天上午12点00分恢复"}', now).freezeMs,
    15 * 60 * 60 * 1000,
  );
});

test('parses English reset time "will reset on today at H:MM AM/PM (UTC+8)"', () => {
  // 2026-05-29 05:00:00 UTC = 13:00 BJT
  const now = new Date('2026-05-29T05:00:00Z');
  const result = diagnoseUpstreamFailure(402, '{"error":"Usage limit reached, will reset on today at 2:51 PM (UTC+8)"}', now);
  assert.equal(result.cause, 'quota');
  // 14:51 BJT = 06:51 UTC, delta = 1h51m = 111min
  assert.equal(result.freezeMs, 111 * 60 * 1000);
});

test('parses English reset time through the named reset minute', () => {
  const now = new Date('2026-05-29T12:12:00.002Z'); // 北京时间 20:12:00.002
  const result = diagnoseUpstreamFailure(402, '{"error":"Usage limit reached, will reset on today at 8:12 PM (UTC+8)"}', now);

  assert.equal(result.cause, 'quota');
  assert.equal(result.freezeMs, 59_998);
});

test('parses English reset time with tomorrow', () => {
  const now = new Date('2026-05-29T10:00:00Z'); // 18:00 BJT
  const result = diagnoseUpstreamFailure(402, '{"error":"Usage limit reached, will reset on tomorrow at 10:32 AM (UTC+8)"}', now);
  // tomorrow 10:32 BJT = 2026-05-30 02:32 UTC, delta = 16h32m
  assert.equal(result.freezeMs, (16 * 60 + 32) * 60 * 1000);
});

test('parses English reset time with month-day date', () => {
  const now = new Date('2026-05-30T04:27:29.167Z'); // 12:27:29.167 BJT
  const result = diagnoseUpstreamFailure(
    402,
    '{"error":"Usage limit reached, will reset on Jun 3 at 4:58 PM (UTC+8)"}',
    now,
  );

  assert.equal(result.cause, 'quota');
  assert.equal(result.freezeMs, 361_830_833);
});

test('parses English month-day reset time through the named reset minute', () => {
  const now = new Date('2026-06-03T08:58:00.002Z'); // 北京时间 16:58:00.002
  const result = diagnoseUpstreamFailure(402, '{"error":"Usage limit reached, will reset on Jun 3 at 4:58 PM (UTC+8)"}', now);

  assert.equal(result.cause, 'quota');
  assert.equal(result.freezeMs, 59_998);
});
