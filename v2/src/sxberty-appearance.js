const FACE_KEYS = ["normal", "neutral", "displeased", "angry", "abandoned"];

export function getDeathFace(value) {
  const happiness = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
  if (happiness > 80) return "neutral";
  if (happiness >= 60) return "displeased";
  if (happiness >= 40) return "angry";
  return "abandoned";
}

export function getFaceBlend(value, face = null) {
  if (FACE_KEYS.includes(face)) return { from: face, to: face, mix: 0 };
  const happiness = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
  const expression = happiness > 80 ? "normal"
    : happiness >= 60 ? "neutral"
    : happiness >= 40 ? "displeased"
    : happiness >= 20 ? "angry"
    : "abandoned";
  return { from: expression, to: expression, mix: 0 };
}
