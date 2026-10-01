export const PET_SIZE = 84;
export const ITEM_SIZE = 52;
export const DRAG_THRESHOLD = 5;
export const VELOCITY_WINDOW_MS = 100;
export const MAX_THROW_SPEED = 1800;
export const MIN_THROW_SPEED = 180;
export const GRAVITY = 1800;
export const MAX_FRAME_MS = 50;
export const MAX_SUBSTEP_MS = 1000 / 120;
export const SPAWN_INTERVAL_MS = 60_000;
export const ITEM_LIFETIME_MS = 120_000;
export const FOOD_CHANCE = 0.2;
export const LAVA_CHANCE = 0.1;
export const MAX_FOODS = 3;

const finite = value => Number.isFinite(value) ? value : 0;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function crossedDragThreshold(start, point) {
  return Math.hypot(point.x - start.x, point.y - start.y) >= DRAG_THRESHOLD;
}

export function samplePointer(samples, point, now) {
  const t = finite(now);
  return [...samples.filter(sample => sample.t >= t - VELOCITY_WINDOW_MS && sample.t <= t), {
    x: finite(point.x), y: finite(point.y), t,
  }].slice(-32);
}

/** Recent displacement, never a velocity accumulated over the entire gesture. */
export function getThrowVelocity(samples, now) {
  const recent = samples.filter(sample => Number.isFinite(sample.x) && Number.isFinite(sample.y)
    && Number.isFinite(sample.t) && sample.t >= now - VELOCITY_WINDOW_MS && sample.t <= now);
  if (recent.length < 2) return { vx: 0, vy: 0 };
  const first = recent[0];
  const last = recent[recent.length - 1];
  const seconds = (last.t - first.t) / 1000;
  if (seconds < 0.008) return { vx: 0, vy: 0 };
  const vx = (last.x - first.x) / seconds;
  const vy = (last.y - first.y) / seconds;
  const scale = Math.min(1, MAX_THROW_SPEED / (Math.hypot(vx, vy) || 1));
  return { vx: vx * scale, vy: vy * scale };
}

/** A slow/tab-resume frame can never create a giant physics step. */
export function getSubsteps(deltaMs) {
  const bounded = clamp(finite(deltaMs), 0, MAX_FRAME_MS);
  if (!bounded) return [];
  const count = Math.ceil(bounded / MAX_SUBSTEP_MS);
  return Array.from({ length: count }, () => bounded / count / 1000);
}

export function overlaps(a, b, inset = 0) {
  return a.x + a.width - inset > b.x + inset && a.x + inset < b.x + b.width - inset
    && a.y + a.height - inset > b.y + inset && a.y + inset < b.y + b.height - inset;
}

/** Swept rectangle collision also catches fast throws that cross a small item. */
export function sweptCollision(before, after, target, inset = 0) {
  if (overlaps(before, target, inset) || overlaps(after, target, inset)) return true;
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  let enter = 0;
  let exit = 1;
  const axes = [
    [before.x, dx, target.x - before.width + inset * 2, target.x + target.width - inset * 2],
    [before.y, dy, target.y - before.height + inset * 2, target.y + target.height - inset * 2],
  ];
  for (const [origin, distance, min, max] of axes) {
    if (distance === 0) {
      if (origin <= min || origin >= max) return false;
      continue;
    }
    const first = (min - origin) / distance;
    const second = (max - origin) / distance;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (enter > exit) return false;
  }
  return enter <= exit && exit >= 0 && enter <= 1;
}

export function fullyOutside(body, viewport) {
  return body.x + body.width <= 0 || body.x >= viewport.width
    || body.y + body.height <= 0 || body.y >= viewport.height;
}

/** The viewport sides/top are open; only its inset floor bounces. */
export function stepBody(body, seconds, viewport) {
  const dt = clamp(finite(seconds), 0, MAX_SUBSTEP_MS / 1000);
  const next = { ...body, vx: finite(body.vx), vy: finite(body.vy) + GRAVITY * dt };
  next.x += next.vx * dt;
  next.y += next.vy * dt;
  let settled = false;
  const floor = viewport.floor ?? viewport.height - 18;
  if (next.x + next.width > 0 && next.x < viewport.width && next.y + next.height >= floor && next.vy >= 0) {
    next.y = floor - next.height;
    next.vy = next.vy > 100 ? -next.vy * 0.34 : 0;
    next.vx *= Math.exp(-9 * dt);
    if (Math.abs(next.vx) < 35) next.vx = 0;
    settled = next.vx === 0 && next.vy === 0;
  }
  return { body: next, settled };
}

export function classifyRelease({ dragged, velocity = {}, outside = false, lava = false }) {
  if (!dragged) return 'click';
  if (outside) return 'offscreen';
  if (lava) return 'lava';
  return Math.hypot(finite(velocity.vx), finite(velocity.vy)) >= MIN_THROW_SPEED ? 'throw' : 'drop';
}

/** Never charge an ordinary throw at launch: an eventual exit costs five TOTAL. */
export function getFlightEvent({ thrown = false, settled = false, caught = false, outside = false, lava = false, cancelled = false }) {
  if (cancelled) return null;
  if (outside) return 'offscreen';
  if (lava) return 'lava';
  return thrown && (settled || caught) ? 'throw' : null;
}

/** At most one opportunity, with no offline/multi-minute catch-up burst. */
export function advanceSpawnClock(elapsedMs, deltaMs, active = true) {
  const elapsed = clamp(finite(elapsedMs), 0, SPAWN_INTERVAL_MS - 1);
  if (!active) return { elapsedMs: elapsed, due: false };
  const delta = Math.max(0, finite(deltaMs));
  const total = elapsed + Math.min(delta, SPAWN_INTERVAL_MS);
  return total >= SPAWN_INTERVAL_MS
    ? { elapsedMs: delta >= SPAWN_INTERVAL_MS ? 0 : total - SPAWN_INTERVAL_MS, due: true }
    : { elapsedMs: total, due: false };
}

export function shouldSpawn(chance, count, maximum, random = Math.random) {
  return count < maximum && random() < chance;
}

export function chooseEnabledFood(foods, random = Math.random) {
  const enabled = Array.isArray(foods) ? foods.filter(food => food?.enabled && food.id && food.url) : [];
  return enabled.length ? enabled[clamp(Math.floor(random() * enabled.length), 0, enabled.length - 1)] : null;
}
