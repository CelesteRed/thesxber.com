import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SXBERTY_SETTINGS, SXBERTY_PHASES, validateSxbertyPatch } from "../shared/sxberty.js";
import { getSxbertyPhraseError, parseSxbertyPhrases, updateSxbertyDraft } from "./sxberty-drafts.js";

const baseline = () => ({ phrases: Object.fromEntries(SXBERTY_PHASES.map(phase => [phase.id, [`Saved ${phase.id}`]])) });

test("phrase text trims lines, ignores empty lines, and supports pasted line endings", () => {
  assert.deepEqual(parseSxbertyPhrases("  Hello Sxberty  \r\n\n  Stay a while \rGoodnight  "), ["Hello Sxberty", "Stay a while", "Goodnight"]);
  assert.deepEqual(parseSxbertyPhrases(" \n \r\n "), []);
});

test("a phase edit creates a sparse PATCH-compatible draft without mutating the baseline", () => {
  const settings = baseline();
  const phrases = ["Hello Sxberty"];
  const draft = updateSxbertyDraft(settings, undefined, "happy", phrases);
  assert.deepEqual(draft, { phrases: { happy: ["Hello Sxberty"] } });
  assert.deepEqual(validateSxbertyPatch(draft), draft);
  assert.deepEqual(settings, baseline());
  phrases.push("Not part of the draft");
  assert.deepEqual(draft.phrases.happy, ["Hello Sxberty"]);
});

test("edits preserve other changed phases and reversion removes only that phase", () => {
  const settings = baseline();
  const first = updateSxbertyDraft(settings, {}, "uneasy", ["Please stay"]);
  const second = updateSxbertyDraft(settings, first, "angry", ["Come back"]);
  assert.deepEqual(first, { phrases: { uneasy: ["Please stay"] } });
  assert.deepEqual(second, { phrases: { uneasy: ["Please stay"], angry: ["Come back"] } });
  const reverted = updateSxbertyDraft(settings, second, "uneasy", [...settings.phrases.uneasy]);
  assert.deepEqual(reverted, { phrases: { angry: ["Come back"] } });
  assert.deepEqual(updateSxbertyDraft(settings, reverted, "angry", [...settings.phrases.angry]), {});
});

test("clearing a saved phase sends an empty array, while an already-empty phase is unchanged", () => {
  const settings = baseline();
  const cleared = updateSxbertyDraft(settings, {}, "abandoned", []);
  assert.deepEqual(cleared, { phrases: { abandoned: [] } });
  assert.deepEqual(validateSxbertyPatch(cleared), cleared);
  const saved = { phrases: { ...settings.phrases, abandoned: [] } };
  assert.deepEqual(updateSxbertyDraft(saved, {}, "abandoned", []), {});
});

test("identical default content is clean, but phrase reordering is a change", () => {
  const defaults = DEFAULT_SXBERTY_SETTINGS;
  assert.deepEqual(updateSxbertyDraft(defaults, {}, "happy", [...defaults.phrases.happy]), {});
  const settings = { phrases: { ...baseline().phrases, happy: ["First", "Second"] } };
  assert.deepEqual(updateSxbertyDraft(settings, {}, "happy", ["Second", "First"]), { phrases: { happy: ["Second", "First"] } });
});

test("unknown phases are rejected", () => {
  assert.throws(() => updateSxbertyDraft(baseline(), {}, "unknown", ["Hello"]), /Unknown Sxberty phase/);
});

test("phase validation accepts the limits and reports over-limit or control-character content", () => {
  assert.equal(getSxbertyPhraseError([]), "");
  assert.equal(getSxbertyPhraseError(Array(20).fill("x".repeat(160))), "");
  assert.match(getSxbertyPhraseError(Array(21).fill("Hello")), /20/);
  assert.match(getSxbertyPhraseError(["x".repeat(161)]), /160/);
  for (const phrase of ["", " ", "hidden\u0000text", "two\nlines", "tab\ttext", "line\u2028separator"]) {
    assert.match(getSxbertyPhraseError([phrase]), /plain-text/);
  }
});

test("invalid drafts remain intact for correction rather than being truncated", () => {
  const settings = baseline();
  const draft = updateSxbertyDraft(settings, {}, "upset", ["x".repeat(161)]);
  assert.equal(draft.phrases.upset[0].length, 161);
  assert.throws(() => validateSxbertyPatch(draft));
  assert.equal(draft.phrases.upset[0].length, 161);
  const corrected = updateSxbertyDraft(settings, draft, "upset", ["Please visit Sxberty"]);
  assert.deepEqual(validateSxbertyPatch(corrected), corrected);
});
