import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAG_THRESHOLD, MAX_THROW_SPEED, MAX_FRAME_MS, MAX_SUBSTEP_MS,
  SPAWN_INTERVAL_MS, FOOD_CHANCE, LAVA_CHANCE, MAX_FOODS,
  crossedDragThreshold, samplePointer, getThrowVelocity, getSubsteps,
  overlaps, sweptCollision, fullyOutside, stepBody, classifyRelease, getFlightEvent,
  advanceSpawnClock, shouldSpawn, chooseEnabledFood,
} from './sxberty-physics.js';

const viewport = { width: 800, height: 600, floor: 582 };
const body = (props = {}) => ({ x: 100, y: 100, width: 84, height: 84, vx: 0, vy: 0, ...props });
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ≈ ${b}`);

test('five-pixel threshold distinguishes clicks from mouse/touch drags', () => {
  assert.equal(DRAG_THRESHOLD, 5);
  assert.equal(crossedDragThreshold({ x: 10, y: 20 }, { x: 14.9, y: 20 }), false);
  assert.equal(crossedDragThreshold({ x: 10, y: 20 }, { x: 13, y: 24 }), true);
  assert.equal(crossedDragThreshold({ x: 10, y: 20 }, { x: 4, y: 20 }), true);
});

test('velocity uses only the recent 100ms, including a stationary release', () => {
  let samples = [];
  for (const [x, y, t] of [[0, 0, 0], [500, 0, 200], [550, -25, 250], [600, -50, 300]]) {
    samples = samplePointer(samples, { x, y }, t);
  }
  assert.equal(samples.length, 3);
  assert.deepEqual(getThrowVelocity(samples, 300), { vx: 1000, vy: -500 });
  samples = samplePointer(samples, { x: 600, y: -50 }, 500);
  assert.deepEqual(getThrowVelocity(samples, 500), { vx: 0, vy: 0 });
  assert.deepEqual(getThrowVelocity([], 500), { vx: 0, vy: 0 });
  assert.deepEqual(getThrowVelocity([{ x: 0, y: 0, t: 0 }, { x: 10, y: 10, t: 1 }], 1), { vx: 0, vy: 0 });
});

test('fast throws are magnitude-capped, preserve direction, and ignore malformed samples', () => {
  const velocity = getThrowVelocity([{ x: 0, y: 0, t: 0 }, { x: 1000, y: -1000, t: 20 }], 20);
  near(Math.hypot(velocity.vx, velocity.vy), MAX_THROW_SPEED);
  near(velocity.vx, -velocity.vy);
  assert.deepEqual(getThrowVelocity([{ x: NaN, y: 0, t: 10 }, { x: 0, y: 0, t: 20 }], 20), { vx: 0, vy: 0 });
  let samples = [];
  for (let t = 0; t < 1000; t += 1) samples = samplePointer(samples, { x: t, y: 0 }, t);
  assert.ok(samples.length <= 32);
});

test('frame deltas and substeps stay bounded after slow frames or tab suspension', () => {
  for (const delta of [0, -10, NaN, Infinity]) assert.deepEqual(getSubsteps(delta), []);
  for (const delta of [8, 16, 50, 100, 600_000]) {
    const steps = getSubsteps(delta);
    assert.ok(steps.length <= 6);
    assert.ok(steps.every(seconds => seconds <= MAX_SUBSTEP_MS / 1000 + 1e-10));
    near(steps.reduce((sum, seconds) => sum + seconds * 1000, 0), Math.min(delta, MAX_FRAME_MS));
  }
});

test('gravity and floor bounce settle with finite velocities and no side walls', () => {
  let current = body({ y: 480, vx: 260, vy: 700 });
  const first = stepBody(current, 1 / 120, viewport);
  assert.ok(first.body.y > current.y);
  let bounced = false;
  let settled = false;
  for (let frame = 0; frame < 2400; frame += 1) {
    const step = stepBody(current, 1 / 120, viewport);
    if (step.body.vy < 0) bounced = true;
    current = step.body;
    settled = step.settled;
    if (settled) break;
  }
  assert.equal(bounced, true);
  assert.equal(settled, true);
  assert.equal(current.y, viewport.floor - current.height);
  assert.equal(current.vx, 0);
  assert.equal(current.vy, 0);
  const leaving = stepBody(body({ x: 790, vx: 1800 }), 1 / 120, viewport).body;
  assert.ok(leaving.x > viewport.width);
  assert.ok(leaving.vx > 0);
});

test('all four exits require the whole body outside, not a partly clipped sprite', () => {
  for (const props of [{ x: -83 }, { x: 799 }, { y: -83 }, { y: 599 }]) assert.equal(fullyOutside(body(props), viewport), false);
  for (const props of [{ x: -84 }, { x: 800 }, { y: -84 }, { y: 600 }]) assert.equal(fullyOutside(body(props), viewport), true);
});

test('collision inset avoids transparent edges and swept hits prevent tunnelling', () => {
  const target = body({ x: 200, y: 100, width: 52, height: 52 });
  assert.equal(overlaps(body({ x: 120 }), target), true);
  assert.equal(overlaps(body({ x: 120 }), target, 7), false);
  assert.equal(overlaps(body({ x: 150 }), target, 7), true);
  assert.equal(sweptCollision(body({ x: 0 }), body({ x: 400 }), target, 7), true);
  assert.equal(sweptCollision(body({ x: 0, y: 300 }), body({ x: 400, y: 300 }), target, 7), false);
  assert.equal(sweptCollision(body({ x: 200, y: -100 }), body({ x: 200, y: 300 }), target, 7), true);
  assert.equal(sweptCollision(body({ x: 0 }), body({ x: 0 }), target, 7), false);
});

test('simple drags are free; release speed classifies throws, not gravity after release', () => {
  assert.equal(classifyRelease({ dragged: false, velocity: { vx: 900 } }), 'click');
  assert.equal(classifyRelease({ dragged: true, velocity: { vx: 100, vy: 100 } }), 'drop');
  assert.equal(classifyRelease({ dragged: true, velocity: { vx: 180, vy: 0 } }), 'throw');
  assert.equal(classifyRelease({ dragged: true, velocity: { vx: 0, vy: -500 } }), 'throw');
  assert.equal(classifyRelease({ dragged: true, outside: true }), 'offscreen');
  assert.equal(classifyRelease({ dragged: true, lava: true }), 'lava');
  assert.equal(getFlightEvent({ settled: true }), null);
});

test('normal charge is deferred until settling/catching and death replaces it', () => {
  assert.equal(getFlightEvent({ thrown: true }), null);
  assert.equal(getFlightEvent({ thrown: true, settled: true }), 'throw');
  assert.equal(getFlightEvent({ thrown: true, caught: true }), 'throw');
  assert.equal(getFlightEvent({ thrown: true, outside: true }), 'offscreen');
  assert.equal(getFlightEvent({ thrown: true, outside: true, settled: true }), 'offscreen');
  assert.equal(getFlightEvent({ thrown: true, lava: true, settled: true }), 'lava');
  assert.equal(getFlightEvent({ outside: true }), 'offscreen');
  assert.equal(getFlightEvent({ lava: true }), 'lava');
  assert.equal(getFlightEvent({ thrown: true, settled: true, cancelled: true }), null);
  assert.equal(getFlightEvent({ thrown: true, lava: true, cancelled: true }), null);
  // One release has one terminal outcome, rather than a launch charge plus death.
  const outcomes = [getFlightEvent({ thrown: true }), getFlightEvent({ thrown: true, outside: true })].filter(Boolean);
  assert.deepEqual(outcomes, ['offscreen']);
});

test('spawn clocks have no immediate opportunity and honor the exact minute boundary', () => {
  assert.deepEqual(advanceSpawnClock(0, 0), { elapsedMs: 0, due: false });
  assert.deepEqual(advanceSpawnClock(0, 59_999), { elapsedMs: 59_999, due: false });
  assert.deepEqual(advanceSpawnClock(59_999, 1), { elapsedMs: 0, due: true });
  assert.deepEqual(advanceSpawnClock(59_990, 25), { elapsedMs: 15, due: true });
  assert.deepEqual(advanceSpawnClock(30_000, 180_000, false), { elapsedMs: 30_000, due: false });
  assert.deepEqual(advanceSpawnClock(30_000, 0), { elapsedMs: 30_000, due: false });
});

test('multi-minute stalls produce at most one opportunity without a catch-up remainder', () => {
  assert.equal(SPAWN_INTERVAL_MS, 60_000);
  assert.deepEqual(advanceSpawnClock(59_999, 600_000), { elapsedMs: 0, due: true });
  assert.deepEqual(advanceSpawnClock(0, 1), { elapsedMs: 1, due: false });
  assert.deepEqual(advanceSpawnClock(NaN, Infinity), { elapsedMs: 0, due: false });
  assert.deepEqual(advanceSpawnClock(0, -100), { elapsedMs: 0, due: false });
});

test('food and lava rolls are independent strict probabilities with item caps', () => {
  assert.equal(FOOD_CHANCE, 0.2);
  assert.equal(LAVA_CHANCE, 0.1);
  assert.equal(MAX_FOODS, 3);
  assert.equal(shouldSpawn(FOOD_CHANCE, 0, MAX_FOODS, () => 0.199999), true);
  assert.equal(shouldSpawn(FOOD_CHANCE, 0, MAX_FOODS, () => 0.2), false);
  assert.equal(shouldSpawn(LAVA_CHANCE, 0, 1, () => 0.099999), true);
  assert.equal(shouldSpawn(LAVA_CHANCE, 0, 1, () => 0.1), false);
  assert.equal(shouldSpawn(FOOD_CHANCE, 3, MAX_FOODS, () => 0), false);
  assert.equal(shouldSpawn(LAVA_CHANCE, 1, 1, () => 0), false);
  let opportunities = 0;
  let elapsedMs = 0;
  for (let frame = 0; frame < 5 * 60 * 20; frame += 1) {
    const next = advanceSpawnClock(elapsedMs, 50);
    elapsedMs = next.elapsedMs;
    if (next.due) opportunities += 1;
  }
  assert.equal(opportunities, 5);
});

test('uniform catalog selection excludes disabled/missing-image entries', () => {
  const foods = [
    { id: 'a', enabled: true, url: '/a.png' },
    { id: 'disabled', enabled: false, url: '/no.png' },
    { id: 'missing', enabled: true },
    { id: 'b', enabled: true, url: '/b.png' },
    { id: 'c', enabled: true, url: '/c.png' },
  ];
  assert.equal(chooseEnabledFood(foods, () => 0).id, 'a');
  assert.equal(chooseEnabledFood(foods, () => 1 / 3).id, 'b');
  assert.equal(chooseEnabledFood(foods, () => 2 / 3).id, 'c');
  assert.equal(chooseEnabledFood(foods, () => 0.999999).id, 'c');
  assert.equal(chooseEnabledFood([], () => 0), null);
  assert.equal(chooseEnabledFood(null, () => 0), null);
});
