export const RETURN_LINES = Object.freeze({
  offscreen: Object.freeze([
    'Sxberty fell offscreen. That was a long drop.',
    'Sxberty slipped past the screen edge. Ouch.',
    'Sxberty fell out of view. Please mind the edge.',
    'Sxberty tumbled offscreen. Not a fun landing.',
  ]),
  lava: Object.freeze([
    'Sxberty fell into lava. That really stung.',
    'Sxberty touched lava. Too hot for comfort.',
    'Sxberty landed in lava. Please find cooler ground.',
    'Sxberty got burned by lava. A little upset now.',
  ]),
  monster: Object.freeze([
    'Sxberty got caught by a monster. That was mean.',
    'Sxberty met a hungry monster. Not a nice hello.',
    'Sxberty was knocked down by a monster. Ouch.',
    'Sxberty lost to a monster. A rematch can wait.',
  ]),
});

export function chooseReturnLine(reason, { random = Math.random, previous = null } = {}) {
  if (!Object.hasOwn(RETURN_LINES, reason)) return null;

  const available = RETURN_LINES[reason].filter((line) => line !== previous);
  let sample = 0;
  try {
    const value = typeof random === 'function' ? random() : 0;
    if (typeof value === 'number' && Number.isFinite(value)) {
      sample = Math.max(0, Math.min(1, value));
    }
  } catch {
    // A broken random source still produces a valid, non-repeating line.
  }

  const index = Math.min(available.length - 1, Math.floor(sample * available.length));
  return available[index];
}
