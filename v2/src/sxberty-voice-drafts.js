import { validateSxbertyVoicePatch } from "../shared/sxberty-voices.js";

const EDITABLE_FIELDS = ["name", "enabled", "trigger", "caption"];
export const sxbertyVoiceDraftKey = id => `sxberty-voice:${id}`;

export function updateSxbertyVoiceDraft(entry, draft = {}, changes = {}) {
  const values = { ...draft, ...changes };
  return Object.fromEntries(EDITABLE_FIELDS.filter(key => Object.hasOwn(values, key) && values[key] !== entry[key]).map(key => [key, values[key]]));
}

export function getSxbertyVoiceDraftError(draft) {
  if (!draft || !Object.keys(draft).length) return "";
  try { validateSxbertyVoicePatch(draft); return ""; }
  catch (error) { return error.message; }
}

export function getSxbertyVoiceCounts(items, drafts, errors) {
  return items.reduce((counts, item) => {
    const key = sxbertyVoiceDraftKey(item.id);
    if (drafts[key]) counts.dirty++;
    if (errors[key] || getSxbertyVoiceDraftError(drafts[key])) counts.errors++;
    return counts;
  }, { dirty: 0, errors: 0 });
}

// Catalog reads and mutations share a generation. Invalidating before a write
// or session change prevents an older response from reinstalling its baseline.
export function createSxbertyVoiceVersionGuard() {
  let version = 0;
  return Object.freeze({
    begin: () => ++version,
    invalidate: () => ++version,
    isCurrent: token => token === version
  });
}
