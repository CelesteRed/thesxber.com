import { COUNTDOWN_MS } from "./verity-pet.js";

const clamp = value => Math.max(0, Math.min(1, value));
const mix = (from, to, amount) => from.map((value, index) => Math.round(value + (to[index] - value) * amount));
const colors = [
  [[244, 251, 243], [233, 233, 233], [91, 28, 33]],
  [[219, 238, 216], [186, 186, 186], [57, 10, 17]],
  [[178, 225, 175], [130, 130, 130], [27, 1, 7]],
];
const rgb = value => `rgb(${value.join(", ")})`;

export function getDoomPresentation(pet, now = Date.now()) {
  const active = pet?.stage === "countdown" || pet?.stage === "scaring";
  const elapsed = Number.isFinite(now) && Number.isFinite(pet?.stageStartedAt) ? Math.max(0, now - pet.stageStartedAt) : 0;
  const progress = !active ? 0 : pet.stage === "scaring" ? 1 : clamp(elapsed / COUNTDOWN_MS);
  const gray = clamp(progress * 2);
  const red = clamp((progress - 0.5) * 2);
  const secondsRemaining = active && pet.stage === "countdown" ? Math.ceil(Math.max(0, COUNTDOWN_MS - elapsed) / 1000) : 0;
  const time = `${String(Math.floor(secondsRemaining / 60)).padStart(2, "0")}:${String(secondsRemaining % 60).padStart(2, "0")}`;
  const background = colors.map(([green, grey, crimson]) => rgb(mix(mix(green, grey, gray), crimson, red)));
  return {
    active, progress, gray, red, secondsRemaining, time,
    phase: progress >= 1 ? "too-late" : red > 0 ? "reddening" : "graying",
    filter: `grayscale(${gray.toFixed(3)}) sepia(${red.toFixed(3)}) saturate(${(1 + red * 4).toFixed(3)}) hue-rotate(${(-red * 35).toFixed(3)}deg) brightness(${(1 - red * 0.2).toFixed(3)})`,
    background: `linear-gradient(180deg, ${background[0]} 0%, ${background[1]} 45%, ${background[2]} 100%)`,
    text: rgb(red >= 0.5 ? [255, 224, 224] : mix([26, 66, 29], [20, 20, 20], gray)),
  };
}
