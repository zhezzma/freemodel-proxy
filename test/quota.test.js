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
