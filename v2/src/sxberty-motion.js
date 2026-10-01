export const HOP_DURATION_SECONDS = 0.9;

// Seconds, height in pixels, horizontal scale. Vertical scale is reciprocal
// so anticipation, launch, and landing preserve the pet's apparent area.
const HOP_FRAMES = [
  [0, 0, 1],
  [0.09, 0, 1.16], // Grounded anticipation.
  [0.12, 0, 1.08], // Release from the ground.
  [0.21, 15, 0.84], // Tall, narrow launch.
  [0.405, 26, 1], // Round apex.
  [0.6, 14, 0.86], // Stretch on descent.
  [0.69, 0, 1.06], // Ground contact.
  [0.75, 0, 1.22], // Wide, flat landing squash.
  [HOP_DURATION_SECONDS, 0, 1], // Recover to the exact neutral pose.
];

function pose(height, scaleX) {
  const elevation = height / 26;
  return {
    height,
    scaleX,
    scaleY: 1 / scaleX,
    shadowScale: 1 - 0.45 * elevation,
    shadowOpacity: 0.28 - 0.16 * elevation,
  };
}

/** Deterministic pose for an elapsed time in seconds; no clock or DOM state. */
export function getHopPose(elapsedSeconds) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return pose(0, 1);
  }

  const phase = elapsedSeconds % HOP_DURATION_SECONDS;
  // Floating-point remainder may put an exact cycle endpoint just before 0.9.
  if (phase < 1e-10 || HOP_DURATION_SECONDS - phase < 1e-10) {
    return pose(0, 1);
  }

  for (let index = 1; index < HOP_FRAMES.length; index += 1) {
    const [end, endHeight, endScale] = HOP_FRAMES[index];
    if (phase > end) continue;
    const [start, startHeight, startScale] = HOP_FRAMES[index - 1];
    const progress = (phase - start) / (end - start);
    const eased = progress * progress * (3 - 2 * progress);
    return pose(
      startHeight + (endHeight - startHeight) * eased,
      startScale + (endScale - startScale) * eased,
    );
  }

  return pose(0, 1);
}
