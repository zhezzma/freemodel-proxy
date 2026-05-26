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
