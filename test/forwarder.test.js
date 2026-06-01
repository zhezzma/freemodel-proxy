import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAccountIp } from '../src/forwarder.js';

test('applyAccountIp forces account ip into x-forwarded-for and x-real-ip, overriding incoming values', () => {
  const headers = {
    'x-forwarded-for': '10.0.0.1',
    'x-real-ip': '10.0.0.2',
    'content-type': 'application/json',
  };

  const out = applyAccountIp(headers, '203.0.113.10');

  assert.equal(out['x-forwarded-for'], '203.0.113.10');
  assert.equal(out['x-real-ip'], '203.0.113.10');
  assert.equal(out['content-type'], 'application/json');
});

test('applyAccountIp strips every leakable client ip header before injecting account ip', () => {
  const headers = {
    'x-forwarded-for': '10.0.0.1',
    'x-real-ip': '10.0.0.2',
    forwarded: 'for=10.0.0.3',
    'cf-connecting-ip': '10.0.0.4',
    'true-client-ip': '10.0.0.5',
    'x-client-ip': '10.0.0.6',
    'x-cluster-client-ip': '10.0.0.7',
    'fastly-client-ip': '10.0.0.8',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'evil.example.com',
    'x-forwarded-port': '443',
  };

  const out = applyAccountIp(headers, '198.51.100.22');

  assert.equal(out['x-forwarded-for'], '198.51.100.22');
  assert.equal(out['x-real-ip'], '198.51.100.22');
  for (const stripped of [
    'forwarded', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip',
    'x-cluster-client-ip', 'fastly-client-ip', 'x-forwarded-proto',
    'x-forwarded-host', 'x-forwarded-port',
  ]) {
    assert.equal(out[stripped], undefined, `${stripped} should be stripped`);
  }
});

test('applyAccountIp is case-insensitive when stripping incoming headers', () => {
  const headers = {
    'X-Forwarded-For': '10.0.0.1',
    'CF-Connecting-IP': '10.0.0.4',
  };

  const out = applyAccountIp(headers, '203.0.113.99');

  assert.equal(out['X-Forwarded-For'], undefined);
  assert.equal(out['CF-Connecting-IP'], undefined);
  assert.equal(out['x-forwarded-for'], '203.0.113.99');
  assert.equal(out['x-real-ip'], '203.0.113.99');
});

test('applyAccountIp without an account ip removes all client ip headers and injects nothing', () => {
  const headers = {
    'x-forwarded-for': '10.0.0.1',
    'x-real-ip': '10.0.0.2',
    'cf-connecting-ip': '10.0.0.4',
    'content-type': 'application/json',
  };

  const out = applyAccountIp(headers, undefined);

  assert.equal(out['x-forwarded-for'], undefined);
  assert.equal(out['x-real-ip'], undefined);
  assert.equal(out['cf-connecting-ip'], undefined);
  assert.equal(out['content-type'], 'application/json');
});

test('applyAccountIp ignores blank ip values and strips instead', () => {
  const headers = { 'x-forwarded-for': '10.0.0.1' };

  const out = applyAccountIp(headers, '   ');

  assert.equal(out['x-forwarded-for'], undefined);
  assert.equal(out['x-real-ip'], undefined);
});
