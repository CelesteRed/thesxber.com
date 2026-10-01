import test from "node:test";
import assert from "node:assert/strict";
import { SXBERTY_VOICE_TRIGGERS, validateSxbertyVoicePatch } from "../shared/sxberty-voices.js";
import { createSxbertyVoiceVersionGuard, getSxbertyVoiceCounts, getSxbertyVoiceDraftError, sxbertyVoiceDraftKey, updateSxbertyVoiceDraft } from "./sxberty-voice-drafts.js";

const baseline = () => ({ id: "voice-a", name: "Hello", enabled: true, trigger: "happy", caption: "", durationMs: 1750, url: "/api/sxberty-voices/voice-a/audio", adminPreviewUrl: "/api/admin/sxberty-voices/voice-a/audio" });

test("voice draft keys cannot collide with food, phrase, or other media drafts", () => {
  assert.equal(sxbertyVoiceDraftKey("voice-a"), "sxberty-voice:voice-a");
  assert.notEqual(sxbertyVoiceDraftKey("sxberty"), "sxberty");
  assert.notEqual(sxbertyVoiceDraftKey("voice-a"), "sxberty-food:voice-a");
});

test("voice metadata edits create sparse shared-validator-compatible PATCH drafts", () => {
  const entry = baseline();
  const first = updateSxbertyVoiceDraft(entry, undefined, { enabled: false, trigger: "throw" });
  const second = updateSxbertyVoiceDraft(entry, first, { name: "Whee", caption: "Let me fly!" });
  assert.deepEqual(first, { enabled: false, trigger: "throw" });
  assert.deepEqual(second, { name: "Whee", enabled: false, trigger: "throw", caption: "Let me fly!" });
  assert.deepEqual(validateSxbertyVoicePatch(second), second);
  assert.deepEqual(entry, baseline());
});

test("all configured speech triggers can be selected without an any fallback", () => {
  assert.deepEqual(new Set(SXBERTY_VOICE_TRIGGERS.map(trigger => trigger.id)), new Set(["happy", "uneasy", "neutral", "upset", "angry", "abandoned", "throw", "food", "return-offscreen", "return-lava", "return-monster"]));
  for (const { id } of SXBERTY_VOICE_TRIGGERS) {
    const draft = updateSxbertyVoiceDraft(baseline(), {}, { trigger: id });
    assert.equal(getSxbertyVoiceDraftError(draft), "");
  }
});

test("reverting one voice field preserves other edits and a full revert removes the draft", () => {
  const entry = baseline();
  const changed = updateSxbertyVoiceDraft(entry, {}, { enabled: false, caption: "Hello there" });
  const reverted = updateSxbertyVoiceDraft(entry, changed, { enabled: true });
  assert.deepEqual(reverted, { caption: "Hello there" });
  assert.deepEqual(updateSxbertyVoiceDraft(entry, reverted, { caption: "" }), {});
  assert.deepEqual(changed, { enabled: false, caption: "Hello there" });
});

test("readonly duration and audio metadata cannot leak into voice PATCH requests", () => {
  assert.deepEqual(updateSxbertyVoiceDraft(baseline(), { durationMs: 4000 }, { id: "other", url: "other", adminPreviewUrl: "other", durationMs: 5000, name: "New name" }), { name: "New name" });
});

test("invalid voice edits remain visible for correction instead of being dropped or clamped", () => {
  for (const changes of [{ name: " " }, { name: "a".repeat(81) }, { name: "bad\nname" }, { caption: "a".repeat(161) }, { caption: "bad\u0000caption" }, { trigger: "any" }, { enabled: "false" }]) {
    const draft = updateSxbertyVoiceDraft(baseline(), {}, changes);
    assert.deepEqual(draft, changes);
    assert.ok(getSxbertyVoiceDraftError(draft));
    assert.throws(() => validateSxbertyVoicePatch(draft));
    const original = Object.fromEntries(Object.keys(changes).map(key => [key, baseline()[key]]));
    assert.deepEqual(updateSxbertyVoiceDraft(baseline(), draft, original), {});
  }
  assert.equal(getSxbertyVoiceDraftError({ caption: "" }), "");
  assert.equal(getSxbertyVoiceDraftError({}), "");
  assert.equal(getSxbertyVoiceDraftError(undefined), "");
});

test("voice counts isolate their section and count save failures or invalid drafts once per row", () => {
  const items = [baseline(), { ...baseline(), id: "voice-b" }];
  const drafts = { sxberty: { phrases: { happy: ["Hi"] } }, "sxberty-food:voice-a": { name: "Food" }, "sxberty-voice:voice-a": { caption: "x".repeat(161) }, "sxberty-voice:voice-b": { enabled: false } };
  const errors = { sxberty: "Phrase failure", "sxberty-food:voice-a": "Food failure", "sxberty-voice:voice-a": "Save failed", "sxberty-voice:voice-b": "Retry" };
  assert.deepEqual(getSxbertyVoiceCounts(items, drafts, errors), { dirty: 2, errors: 2 });
  assert.deepEqual(getSxbertyVoiceCounts(items, drafts, {}), { dirty: 2, errors: 1 });
  assert.deepEqual(getSxbertyVoiceCounts(items, {}, {}), { dirty: 0, errors: 0 });
});

test("saved baselines remove only the saved voice draft and leave other failures intact", () => {
  const first = baseline();
  const second = { ...baseline(), id: "voice-b" };
  const drafts = { [sxbertyVoiceDraftKey(first.id)]: { caption: "New caption" }, [sxbertyVoiceDraftKey(second.id)]: { enabled: false } };
  assert.deepEqual(updateSxbertyVoiceDraft({ ...first, caption: "New caption" }, drafts[sxbertyVoiceDraftKey(first.id)], {}), {});
  assert.deepEqual(updateSxbertyVoiceDraft(second, drafts[sxbertyVoiceDraftKey(second.id)], {}), { enabled: false });
  assert.deepEqual(drafts[sxbertyVoiceDraftKey(first.id)], { caption: "New caption" });
});

test("a newer independent catalog request wins over late success or failure from an earlier GET", () => {
  const guard = createSxbertyVoiceVersionGuard();
  const oldRead = guard.begin();
  const newRead = guard.begin();
  assert.equal(guard.isCurrent(oldRead), false);
  assert.equal(guard.isCurrent(newRead), true);
});

test("save, upload, delete, and logout invalidate in-flight voice catalog responses", () => {
  for (const action of ["save", "upload", "delete", "logout"]) {
    const guard = createSxbertyVoiceVersionGuard();
    const lateRead = guard.begin();
    const mutation = guard.invalidate();
    assert.equal(guard.isCurrent(lateRead), false, `${action} must reject a late GET`);
    assert.equal(guard.isCurrent(mutation), true);
    const freshRead = guard.begin();
    assert.equal(guard.isCurrent(freshRead), true);
    assert.equal(guard.isCurrent(lateRead), false);
  }
});

test("session invalidation also rejects a mutation completing after logout", () => {
  const guard = createSxbertyVoiceVersionGuard();
  const upload = guard.invalidate();
  guard.invalidate();
  assert.equal(guard.isCurrent(upload), false);
});
