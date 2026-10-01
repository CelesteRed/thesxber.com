export const SXBERTY_VOICE_NAME_MAX_LENGTH = 80;
export const SXBERTY_VOICE_CAPTION_MAX_LENGTH = 160;
export const SXBERTY_VOICE_MAX_BYTES = 5 * 1024 * 1024;
export const SXBERTY_VOICE_MAX_DURATION_MS = 30000;
export const SXBERTY_VOICE_TRIGGERS = Object.freeze([
  ["happy", "Happy"], ["uneasy", "Uneasy"], ["neutral", "Neutral"],
  ["upset", "Upset"], ["angry", "Angry"], ["abandoned", "Abandoned"],
  ["throw", "Thrown"], ["food", "Fed"], ["return-offscreen", "Return from offscreen"],
  ["return-lava", "Return from lava"], ["return-monster", "Return from monster"]
].map(([id, label]) => Object.freeze({ id, label })));
const triggers = new Set(SXBERTY_VOICE_TRIGGERS.map(item => item.id));
const fields = new Set(["name", "enabled", "trigger", "caption"]);
const forbiddenCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}
export function isSxbertyVoiceId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}
function validateMetadata(body, partial) {
  if (!body || typeof body !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(body))) invalid("Send a plain voice metadata object");
  const keys = Reflect.ownKeys(body);
  if (!keys.length) invalid("Provide voice metadata");
  const result = {};
  for (const key of keys) {
    if (!fields.has(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(body, key), "value")) invalid("Unknown voice metadata field");
    const value = body[key];
    if (key === "name" || key === "caption") {
      const maximum = key === "name" ? SXBERTY_VOICE_NAME_MAX_LENGTH : SXBERTY_VOICE_CAPTION_MAX_LENGTH;
      if (typeof value !== "string" || forbiddenCharacters.test(value) || value.trim().length > maximum || (key === "name" && !value.trim())) invalid(`Voice ${key} must be plain text ${key === "name" ? "between 1 and" : "up to"} ${maximum} characters`);
      result[key] = value.trim();
    } else if (key === "enabled") {
      if (typeof value !== "boolean") invalid("Voice enabled must be a boolean");
      result.enabled = value;
    } else {
      if (!triggers.has(value)) invalid("Choose a valid voice trigger");
      result.trigger = value;
    }
  }
  if (!partial) {
    for (const key of ["name", "trigger"]) if (!Object.hasOwn(result, key)) invalid(`Voice ${key} is required`);
    if (!Object.hasOwn(result, "enabled")) result.enabled = true;
    if (!Object.hasOwn(result, "caption")) result.caption = "";
  }
  return result;
}
export const validateSxbertyVoiceCreate = body => validateMetadata(body, false);
export const validateSxbertyVoicePatch = body => validateMetadata(body, true);

// Never spread stored records: audio, paths, timestamps and future private fields
// must not leak into either catalog. Duration is derived, never editable.
export function toSxbertyVoiceDto(item, admin = false) {
  if (!isSxbertyVoiceId(item?.id)) throw new Error("Invalid stored voice ID");
  const metadata = validateSxbertyVoiceCreate({ name: item.name, enabled: item.enabled, trigger: item.trigger, caption: item.caption });
  const durationMs = item.durationMs ?? item.duration_ms;
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > SXBERTY_VOICE_MAX_DURATION_MS) throw new Error("Invalid stored voice duration");
  return { id: item.id, ...metadata, durationMs, url: `/api/sxberty-voices/${item.id}/audio`,
    ...(admin ? { adminPreviewUrl: `/api/admin/sxberty-voices/${item.id}/audio` } : {}) };
}
export function normalizePublicVoice(value) {
  try {
    if (!value || value.enabled !== true || !isSxbertyVoiceId(value.id) || value.url !== `/api/sxberty-voices/${value.id}/audio` ||
        !Number.isInteger(value.durationMs) || value.durationMs < 1 || value.durationMs > SXBERTY_VOICE_MAX_DURATION_MS) return null;
    return toSxbertyVoiceDto(value);
  } catch { return null; }
}
