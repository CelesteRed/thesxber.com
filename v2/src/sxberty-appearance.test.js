import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { getDeathFace, getFaceBlend } from "./sxberty-appearance.js";
import { getSxbertyPhase } from "../shared/sxberty.js";

test("smile gradually flattens below 80 and expressions become more upset", () => {
  assert.deepEqual(getFaceBlend(100), { from: "normal", to: "normal", mix: 0 });
  assert.deepEqual(getFaceBlend(80), { from: "normal", to: "normal", mix: 0 });
  assert.deepEqual(getFaceBlend(70), { from: "normal", to: "neutral", mix: 0.5 });
  assert.deepEqual(getFaceBlend(60), { from: "normal", to: "neutral", mix: 1 });
  assert.deepEqual(getFaceBlend(50), { from: "neutral", to: "neutral", mix: 0 });
  assert.deepEqual(getFaceBlend(30), { from: "neutral", to: "displeased", mix: 0.5 });
  assert.deepEqual(getFaceBlend(14), { from: "displeased", to: "angry", mix: 0.5 });
  assert.deepEqual(getFaceBlend(4), { from: "angry", to: "abandoned", mix: 0.5 });
  assert.deepEqual(getFaceBlend(0), { from: "angry", to: "abandoned", mix: 1 });
});

test("blend weights stay finite and bounded for every happiness value", () => {
  for (let happiness = -10; happiness <= 110; happiness += 0.1) {
    const blend = getFaceBlend(happiness);
    assert.ok(blend.mix >= 0 && blend.mix <= 1);
    assert.ok(["normal", "neutral", "displeased", "angry", "abandoned"].includes(blend.from));
    assert.ok(["normal", "neutral", "displeased", "angry", "abandoned"].includes(blend.to));
  }
  for (const value of [undefined, null, NaN, Infinity, "0"]) assert.deepEqual(getFaceBlend(value), getFaceBlend(100));
});

test("death expressions are one worse than the pre-loss happiness phase", () => {
  for (const [happiness, face] of [
    [100, "neutral"], [80, "neutral"], [60, "neutral"], [59.99, "displeased"],
    [40, "displeased"], [39.99, "angry"], [20, "angry"], [19.99, "abandoned"], [0, "abandoned"],
  ]) assert.equal(getDeathFace(happiness), face);
  for (const invalid of [undefined, null, NaN, Infinity, "0"]) assert.equal(getDeathFace(invalid), "neutral");
});

test("a temporary forced face bypasses blending without changing happiness", () => {
  for (const face of ["normal", "neutral", "displeased", "angry", "abandoned"]) {
    for (const happiness of [0, 10, 30, 50, 70, 100]) {
      assert.deepEqual(getFaceBlend(happiness, face), { from: face, to: face, mix: 0 });
    }
  }
  for (const invalid of [null, undefined, "", "missing", "toString", {}, []]) {
    assert.deepEqual(getFaceBlend(70, invalid), getFaceBlend(70));
  }
});

test("phrase phases match happiness boundary transitions", () => {
  for (const [happiness, phase] of [[100,"happy"],[80,"happy"],[79.9,"uneasy"],[60,"uneasy"],[59.9,"neutral"],[40,"neutral"],[39.9,"upset"],[20,"upset"],[19.9,"angry"],[0.01,"angry"],[0,"abandoned"]]) {
    assert.equal(getSxbertyPhase(happiness), phase);
  }
});

test("the base and every expression retain registered transparent 1000px canvases", async () => {
  for (const name of ["base", "faces/normal", "faces/normal-open", "faces/neutral", "faces/displeased", "faces/displeased-open", "faces/displeased-eyes", "faces/displeased-eyes-open", "faces/creepy", "faces/creepy-open"]) {
    const image = sharp(new URL(`./assets/verity/${name}.png`, import.meta.url).pathname);
    const metadata = await image.metadata();
    assert.equal(metadata.width, 1000, name);
    assert.equal(metadata.height, 1000, name);
    assert.equal(metadata.hasAlpha, true, name);
    if (name.startsWith("faces/")) {
      const { data } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let visible = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index]) visible++;
      assert.ok(visible > 10000 && visible < 100000, `${name}: face features only, no yellow head`);
    }
  }
  const monster = await sharp(new URL("./assets/verity/monster.webp", import.meta.url).pathname).metadata();
  assert.ok(monster.width > 200 && monster.height > 300);
});
