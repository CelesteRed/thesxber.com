// Happy excludes its 80% lower bound; uneasy includes both 60% and 80%.
// Other upper bounds are exclusive, and angry excludes zero.
export const SXBERTY_PHASES = Object.freeze([
  { id: "happy", label: "Happy", min: 80, max: 100 },
  { id: "uneasy", label: "Uneasy", min: 60, max: 80 },
  { id: "neutral", label: "Neutral", min: 40, max: 60 },
  { id: "upset", label: "Upset", min: 20, max: 40 },
  { id: "angry", label: "Angry", min: 0, max: 20 },
  { id: "abandoned", label: "Abandoned", min: 0, max: 0 }
].map(Object.freeze));

export const DEFAULT_SXBERTY_SETTINGS = Object.freeze({
  phrases: Object.freeze({
    happy: Object.freeze([
      "Sxberty is so happy you're here!",
      "A little company makes Sxberty's day.",
      "Sxberty saved you a cozy spot!",
      "More adventures with Sxberty? Yes, please!"
    ]),
    uneasy: Object.freeze([
      "You're still there, right? Sxberty was just checking.",
      "Sxberty could use a little reassurance.",
      "Did Sxberty do something wrong?",
      "Don't wander too far from Sxberty, okay?"
    ]),
    neutral: Object.freeze([
      "Sxberty is here.",
      "Another minute. Sxberty noticed.",
      "Sxberty doesn't have much to say.",
      "Sxberty is watching the page go by."
    ]),
    upset: Object.freeze([
      "Sxberty thought we were spending time together.",
      "It feels a little lonely over here for Sxberty.",
      "Sxberty misses being your little friend.",
      "Maybe you'll remember Sxberty soon."
    ]),
    angry: Object.freeze([
      "Oh, now you notice Sxberty?",
      "Sxberty is tired of waiting.",
      "Don't pretend you forgot Sxberty was here.",
      "Sxberty won't keep smiling for nothing."
    ]),
    abandoned: Object.freeze([
      "Sxberty waited. You didn't come.",
      "There is nothing left for Sxberty to say.",
      "Sxberty remembers being left alone.",
      "Sxberty will be here when you return."
    ])
  })
});

const phaseIds = new Set(SXBERTY_PHASES.map(phase => phase.id));
const forbiddenCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const isRecord = value => value !== null && typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function cleanPhrases(value, phase) {
  if (!Array.isArray(value) || value.length > 20) invalid(`${phase} phrases must be an array of at most 20 strings`);
  // Array.from also checks sparse entries instead of silently skipping them.
  return Array.from(value, phrase => {
    if (typeof phrase !== "string" || forbiddenCharacters.test(phrase)) {
      invalid(`${phase} phrases must be plain text without newlines or control characters`);
    }
    const trimmed = phrase.trim();
    if (!trimmed || trimmed.length > 160) invalid(`${phase} phrases must be 1-160 characters after trimming`);
    return trimmed;
  });
}

export function getSxbertyPhase(happiness) {
  const value = typeof happiness === "number" && Number.isFinite(happiness) ? happiness : 100;
  if (value <= 0) return "abandoned";
  if (value < 20) return "angry";
  if (value < 40) return "upset";
  if (value < 60) return "neutral";
  if (value <= 80) return "uneasy";
  return "happy";
}

export function normalizeSxbertySettings(raw) {
  const source = isRecord(raw) && isRecord(raw.phrases) ? raw.phrases : {};
  const phrases = {};
  for (const { id } of SXBERTY_PHASES) {
    try {
      phrases[id] = Object.hasOwn(source, id) ? cleanPhrases(source[id], id) : [...DEFAULT_SXBERTY_SETTINGS.phrases[id]];
    } catch {
      phrases[id] = [...DEFAULT_SXBERTY_SETTINGS.phrases[id]];
    }
  }
  return { phrases };
}

export function validateSxbertyPatch(body) {
  if (!isRecord(body)) invalid("Request body must be an object");
  if (Reflect.ownKeys(body).some(key => key !== "phrases")) invalid("Unknown Sxberty settings field");
  if (!Object.hasOwn(body, "phrases") || !isRecord(body.phrases)) invalid("phrases must be an object");
  const keys = Reflect.ownKeys(body.phrases);
  if (!keys.length) invalid("Provide at least one phase to update");
  if (keys.some(key => !phaseIds.has(key))) invalid("Unknown Sxberty phase");
  const phrases = {};
  for (const id of keys) phrases[id] = cleanPhrases(body.phrases[id], id);
  return { phrases };
}
