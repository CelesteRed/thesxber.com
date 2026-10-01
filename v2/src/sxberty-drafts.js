import { SXBERTY_PHASES } from "../shared/sxberty.js";

// Keep textarea formatting local; only meaningful, trimmed lines enter Save all.
export function parseSxbertyPhrases(text) {
  return text.split(/\r\n|\n|\r/).map(line => line.trim()).filter(Boolean);
}

export function updateSxbertyDraft(settings, draft, phaseId, phrases) {
  if (!SXBERTY_PHASES.some(phase => phase.id === phaseId)) throw new Error("Unknown Sxberty phase.");
  const next = { ...draft?.phrases, [phaseId]: [...phrases] };
  for (const [id, value] of Object.entries(next)) {
    const saved = settings?.phrases?.[id] || [];
    if (value.length === saved.length && value.every((phrase, index) => phrase === saved[index])) delete next[id];
  }
  return Object.keys(next).length ? { phrases: next } : {};
}

export function getSxbertyPhraseError(phrases) {
  if (phrases.length > 20) return "Use at most 20 phrases for this phase.";
  if (phrases.some(phrase => phrase.length > 160)) return "Each phrase must be at most 160 characters.";
  if (phrases.some(phrase => !phrase.trim() || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(phrase))) return "Use plain-text phrases without control characters.";
  return "";
}
