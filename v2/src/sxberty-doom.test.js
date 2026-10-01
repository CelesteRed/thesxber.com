import test from "node:test";
import assert from "node:assert/strict";
import { getDoomPresentation } from "./sxberty-doom.js";
import { COUNTDOWN_MS, createPet } from "./verity-pet.js";

const countdown = { ...createPet(1000), happiness: 0, stage: "countdown", stageStartedAt: 1000 };

test("countdown shows whole remaining seconds without rounding a second twice", () => {
  for (let elapsed = 0; elapsed <= COUNTDOWN_MS; elapsed += 1000) {
    const scene = getDoomPresentation(countdown, 1000 + elapsed);
    const seconds = (COUNTDOWN_MS - elapsed) / 1000;
    assert.equal(scene.secondsRemaining, seconds);
    assert.equal(scene.time, `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`);
  }
  assert.equal(getDoomPresentation(countdown, 1001).time, "01:00");
  assert.equal(getDoomPresentation(countdown, 60_999).time, "00:01");
  assert.equal(getDoomPresentation(countdown, 61_000).time, "00:00");
});

test("the first half drains color and the second half becomes red", () => {
  for (const [seconds, gray, red, phase] of [[0,0,0,"graying"],[15,0.5,0,"graying"],[30,1,0,"graying"],[45,1,0.5,"reddening"],[60,1,1,"too-late"]]) {
    const scene = getDoomPresentation(countdown, 1000 + seconds * 1000);
    assert.equal(scene.active, true);
    assert.equal(scene.gray, gray);
    assert.equal(scene.red, red);
    assert.equal(scene.phase, phase);
    assert.match(scene.background, /^linear-gradient/);
    assert.ok(!scene.filter.includes("NaN"));
  }
});

test("overdue and scaring scenes stay fully red, never wrap the timer", () => {
  const overdue = getDoomPresentation(countdown, 10_000_000);
  assert.equal(overdue.time, "00:00");
  assert.equal(overdue.progress, 1);
  assert.equal(overdue.red, 1);
  const scaring = getDoomPresentation({ ...countdown, stage: "scaring", stageStartedAt: 100_000 }, 100_000);
  assert.equal(scaring.time, "00:00");
  assert.equal(scaring.progress, 1);
});

test("new, forming, and missing pets restore the normal scene", () => {
  for (const pet of [null, createPet(), { ...createPet(), stage: "forming" }]) {
    const scene = getDoomPresentation(pet);
    assert.equal(scene.active, false);
    assert.equal(scene.gray, 0);
    assert.equal(scene.red, 0);
  }
});

test("invalid or backwards clocks do not produce negative countdowns or invalid colors", () => {
  for (const now of [-100, 0, NaN, Infinity]) {
    const scene = getDoomPresentation(countdown, now);
    assert.equal(scene.time, "01:00");
    assert.equal(scene.progress, 0);
    assert.ok(!scene.background.includes("NaN"));
  }
});
