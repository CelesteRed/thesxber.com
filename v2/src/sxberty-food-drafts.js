import { validateSxbertyFoodPatch } from "../shared/sxberty-foods.js";

export const SXBERTY_FOOD_DEFAULT_GAINS = Object.freeze({ fullness: 20, happiness: 10, energy: 5 });
const EDITABLE_FIELDS = ["name", "enabled", "fullness", "happiness", "energy"];
export const sxbertyFoodDraftKey = id => `sxberty-food:${id}`;

export function updateSxbertyFoodDraft(entry, draft = {}, changes = {}) {
  const values = { ...draft, ...changes };
  return Object.fromEntries(EDITABLE_FIELDS.filter(key => Object.hasOwn(values, key) && values[key] !== entry[key]).map(key => [key, values[key]]));
}

export function getSxbertyFoodDraftError(draft) {
  if (!draft || !Object.keys(draft).length) return "";
  try { validateSxbertyFoodPatch(draft); return ""; }
  catch (error) { return error.message; }
}

export function getSxbertyFoodCounts(items, drafts, errors) {
  return items.reduce((counts, item) => {
    const key = sxbertyFoodDraftKey(item.id);
    if (drafts[key]) counts.dirty++;
    if (errors[key] || getSxbertyFoodDraftError(drafts[key])) counts.errors++;
    return counts;
  }, { dirty: 0, errors: 0 });
}
