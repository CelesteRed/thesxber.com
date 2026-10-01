import { COUNTDOWN_MS } from "./verity-pet.js";
const SIZES = [1, 1.08, 1.16, 1.28, 1.45, 1.65, 1.9, 2.3, 3.2, 4.6];
export function getEscalationPose(start, now = Date.now()) {
  const elapsed = Number.isFinite(start) && Number.isFinite(now) ? Math.max(0, now - start) : 0;
  const progress = Math.min(1, elapsed / COUNTDOWN_MS);
  const step = Math.min(SIZES.length - 1, Math.floor(progress * SIZES.length));
  return { step, scale: SIZES[step], centerMix: Math.min(1, step / 3) };
}
