import test from 'node:test';
import assert from 'node:assert/strict';
import { EASE_EDITORIAL, MOTION_DURATION, getStaggerDelay } from './presets';

test('getStaggerDelay clamps delay within interactive latency budget', () => {
  assert.equal(getStaggerDelay(-1), 0);
  assert.equal(getStaggerDelay(0), 0);
  assert.equal(getStaggerDelay(2, 0.04, 0.24), 0.08);
  assert.equal(getStaggerDelay(20, 0.04, 0.24), 0.24);
});

test('editorial motion timings stay crisp and responsive', () => {
  assert.equal(EASE_EDITORIAL.length, 4);
  assert.ok(MOTION_DURATION.fast <= 0.2);
  assert.ok(MOTION_DURATION.normal <= 0.25);
});
