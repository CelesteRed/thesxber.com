import test from "node:test";
import assert from "node:assert/strict";
import { validateSxbertyFoodPatch } from "../shared/sxberty-foods.js";
import { getSxbertyFoodCounts, getSxbertyFoodDraftError, SXBERTY_FOOD_DEFAULT_GAINS, sxbertyFoodDraftKey, updateSxbertyFoodDraft } from "./sxberty-food-drafts.js";

const baseline = () => ({ id: "apple", name: "Apple", enabled: true, fullness: 20, happiness: 10, energy: 5, url: "/api/sxberty-foods/apple/image" });

test("food defaults match upload gains and keys cannot collide with phrase settings", () => {
  assert.deepEqual(SXBERTY_FOOD_DEFAULT_GAINS, { fullness: 20, happiness: 10, energy: 5 });
  assert.equal(sxbertyFoodDraftKey("apple"), "sxberty-food:apple");
  assert.notEqual(sxbertyFoodDraftKey("sxberty"), "sxberty");
});

test("food edits create sparse PATCH-compatible drafts without changing the baseline", () => {
  const entry = baseline();
  const first = updateSxbertyFoodDraft(entry, undefined, { happiness: 0, enabled: false });
  const second = updateSxbertyFoodDraft(entry, first, { name: "Green apple", energy: 100 });
  assert.deepEqual(first, { enabled: false, happiness: 0 });
  assert.deepEqual(second, { name: "Green apple", enabled: false, happiness: 0, energy: 100 });
  assert.deepEqual(validateSxbertyFoodPatch(second), second);
  assert.deepEqual(entry, baseline());
});

test("reverting a field preserves other edits and reverting everything removes the draft", () => {
  const entry = baseline();
  const changed = updateSxbertyFoodDraft(entry, {}, { fullness: 80, energy: 0 });
  const reverted = updateSxbertyFoodDraft(entry, changed, { fullness: 20 });
  assert.deepEqual(reverted, { energy: 0 });
  assert.deepEqual(updateSxbertyFoodDraft(entry, reverted, { energy: 5 }), {});
  assert.deepEqual(changed, { fullness: 80, energy: 0 });
});

test("readonly metadata cannot leak into food PATCH requests", () => {
  assert.deepEqual(updateSxbertyFoodDraft(baseline(), {}, { id: "changed", url: "other", adminPreviewUrl: "other", fullness: 21 }), { fullness: 21 });
});

test("invalid edits survive for correction instead of silently clamping gains", () => {
  for (const value of ["", -1, 101, 1.5, NaN]) {
    const draft = updateSxbertyFoodDraft(baseline(), {}, { fullness: value });
    assert.equal(draft.fullness, value);
    assert.ok(getSxbertyFoodDraftError(draft));
    assert.throws(() => validateSxbertyFoodPatch(draft));
    assert.deepEqual(updateSxbertyFoodDraft(baseline(), draft, { fullness: 20 }), {});
  }
  assert.ok(getSxbertyFoodDraftError({ name: " " }));
  assert.ok(getSxbertyFoodDraftError({ name: "a".repeat(81) }));
  assert.equal(getSxbertyFoodDraftError({ happiness: 0, energy: 100 }), "");
  assert.equal(getSxbertyFoodDraftError({}), "");
  assert.equal(getSxbertyFoodDraftError(undefined), "");
});

test("food counts include saved-request errors and local invalid drafts only once", () => {
  const items = [baseline(), { ...baseline(), id: "berry" }];
  const drafts = { sxberty: { phrases: { happy: ["Hello"] } }, "emoji:apple": { name: "Emoji" }, "sxberty-food:apple": { fullness: "" }, "sxberty-food:berry": { enabled: false } };
  const errors = { "sxberty-food:apple": "Failed", "sxberty-food:berry": "Try again", sxberty: "Phrase error" };
  assert.deepEqual(getSxbertyFoodCounts(items, drafts, errors), { dirty: 2, errors: 2 });
  assert.deepEqual(getSxbertyFoodCounts(items, drafts, {}), { dirty: 2, errors: 1 });
  assert.deepEqual(getSxbertyFoodCounts(items, {}, {}), { dirty: 0, errors: 0 });
});

test("new server baselines do not mutate unrelated food drafts", () => {
  const apple = baseline();
  const berry = { ...baseline(), id: "berry", name: "Berry" };
  const drafts = { [sxbertyFoodDraftKey(apple.id)]: { energy: 25 }, [sxbertyFoodDraftKey(berry.id)]: { enabled: false } };
  const savedApple = { ...apple, energy: 25 };
  assert.deepEqual(updateSxbertyFoodDraft(savedApple, drafts[sxbertyFoodDraftKey(apple.id)], {}), {});
  assert.deepEqual(updateSxbertyFoodDraft(berry, drafts[sxbertyFoodDraftKey(berry.id)], {}), { enabled: false });
  assert.deepEqual(drafts[sxbertyFoodDraftKey(apple.id)], { energy: 25 });
});
