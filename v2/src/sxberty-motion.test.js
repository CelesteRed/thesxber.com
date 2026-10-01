import test from 'node:test';
import assert from 'node:assert/strict';
import { getHopPose, HOP_DURATION_SECONDS } from './sxberty-motion.js';

const NEUTRAL = {
  height: 0,
  scaleX: 1,
  scaleY: 1,
  shadowScale: 1,
  shadowOpacity: 0.28,
};

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
}

test('cycle starts and ends exactly neutral, including repeated endpoints', () => {
  assert.equal(HOP_DURATION_SECONDS, 0.9);
  for (let cycle = 0; cycle <= 100; cycle += 1) {
    assert.deepEqual(getHopPose(cycle * HOP_DURATION_SECONDS), NEUTRAL);
  }
  const beforeEnd = getHopPose(HOP_DURATION_SECONDS - 1e-6);
  close(beforeEnd.scaleX, 1);
  close(beforeEnd.scaleY, 1);
});

test('invalid or negative elapsed time safely returns a fresh neutral pose', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, -1, -0.01, '0.4', {}, [], 1n, Symbol('time')]) {
    assert.deepEqual(getHopPose(value), NEUTRAL);
  }
  const first = getHopPose(0);
  first.height = 100;
  assert.deepEqual(getHopPose(0), NEUTRAL);
});

test('anticipation stays grounded and squashes before a tall launch', () => {
  for (const time of [0.03, 0.09, 0.12]) {
    const anticipation = getHopPose(time);
    assert.equal(anticipation.height, 0);
    assert.ok(anticipation.scaleX > 1);
    assert.ok(anticipation.scaleY < 1);
  }
  const launch = getHopPose(0.21);
  assert.equal(launch.height, 15);
  close(launch.scaleX, 0.84);
  assert.ok(launch.scaleY > 1.18);
});

test('apex is round, high, and followed by a stretched descent', () => {
  const apex = getHopPose(0.405);
  assert.equal(apex.height, 26);
  assert.equal(apex.scaleX, 1);
  assert.equal(apex.scaleY, 1);
  assert.ok(getHopPose(0.35).height < apex.height);
  assert.ok(getHopPose(0.46).height < apex.height);
  const descent = getHopPose(0.6);
  assert.equal(descent.height, 14);
  assert.ok(descent.scaleX < 0.9);
  assert.ok(descent.scaleY > 1.1);
});

test('contact precedes visibly wide, flat landing and grounded recovery', () => {
  const contact = getHopPose(0.69);
  const landing = getHopPose(0.75);
  const recovery = getHopPose(0.825);
  assert.equal(contact.height, 0);
  assert.equal(landing.height, 0);
  assert.equal(recovery.height, 0);
  assert.ok(landing.scaleX >= 1.2);
  assert.ok(landing.scaleY < 0.83);
  assert.ok(landing.scaleX > contact.scaleX);
  assert.ok(recovery.scaleX < landing.scaleX && recovery.scaleX > 1);
  assert.ok(recovery.scaleY > landing.scaleY && recovery.scaleY < 1);
});

test('all poses are finite, bounded, and preserve area throughout the cycle', () => {
  for (let step = 0; step <= 9000; step += 1) {
    const current = getHopPose(step / 10000);
    for (const value of Object.values(current)) assert.ok(Number.isFinite(value));
    assert.ok(current.height >= 0 && current.height <= 26);
    for (const scale of [current.scaleX, current.scaleY]) {
      assert.ok(scale >= 0.78 && scale <= 1.22);
    }
    assert.ok(current.shadowScale >= 0.55 && current.shadowScale <= 1);
    assert.ok(current.shadowOpacity >= 0.12 && current.shadowOpacity <= 0.28);
    close(current.scaleX * current.scaleY, 1);
  }
  for (const time of [1e6, 1e12, Number.MAX_VALUE]) {
    for (const value of Object.values(getHopPose(time))) assert.ok(Number.isFinite(value));
  }
});

test('poses repeat deterministically over many cycles', () => {
  for (const time of [0.03, 0.09, 0.12, 0.21, 0.405, 0.6, 0.69, 0.75, 0.825, 0.899]) {
    const expected = getHopPose(time);
    assert.deepEqual(getHopPose(time), expected);
    for (const cycle of [1, 2, 10, 100]) {
      const actual = getHopPose(time + cycle * HOP_DURATION_SECONDS);
      for (const key of Object.keys(expected)) close(actual[key], expected[key]);
    }
  }
});

test('shadow shrinks and fades with height and returns fully at contact', () => {
  const ascending = [0.12, 0.16, 0.21, 0.3, 0.405].map(getHopPose);
  for (let index = 1; index < ascending.length; index += 1) {
    assert.ok(ascending[index].height > ascending[index - 1].height);
    assert.ok(ascending[index].shadowScale < ascending[index - 1].shadowScale);
    assert.ok(ascending[index].shadowOpacity < ascending[index - 1].shadowOpacity);
  }
  for (const time of [0, 0.09, 0.21, 0.405, 0.6, 0.69, 0.75, 0.9]) {
    const current = getHopPose(time);
    close(current.shadowScale, 1 - 0.45 * current.height / 26);
    close(current.shadowOpacity, 0.28 - 0.16 * current.height / 26);
  }
  assert.equal(getHopPose(0.69).shadowScale, NEUTRAL.shadowScale);
  assert.equal(getHopPose(0.69).shadowOpacity, NEUTRAL.shadowOpacity);
});
