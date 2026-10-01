export function getFaceBlend(value) {
  const happiness = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
  if (happiness >= 80) return { from: "normal", to: "normal", mix: 0 };
  if (happiness >= 60) return { from: "normal", to: "neutral", mix: (80 - happiness) / 20 };
  if (happiness >= 40) return { from: "neutral", to: "neutral", mix: 0 };
  if (happiness >= 20) return { from: "neutral", to: "displeased", mix: (40 - happiness) / 20 };
  if (happiness >= 8) return { from: "displeased", to: "angry", mix: (20 - happiness) / 12 };
  return { from: "angry", to: "abandoned", mix: (8 - happiness) / 8 };
}
