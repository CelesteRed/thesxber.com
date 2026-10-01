import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { getDeathFace, getFaceBlend } from "./sxberty-appearance.js";
import { getSxbertyPhase } from "../shared/sxberty.js";

test("expressions snap to one face at every happiness boundary", () => {
  for (const [happiness, face] of [
    [110, "normal"], [100, "normal"], [80.01, "normal"],
    [80, "neutral"], [70, "neutral"], [60, "neutral"],
    [59.99, "displeased"], [50, "displeased"], [40, "displeased"],
    [39.99, "angry"], [30, "angry"], [20, "angry"],
    [19.99, "abandoned"], [14, "abandoned"], [4, "abandoned"], [0, "abandoned"], [-10, "abandoned"],
  ]) assert.deepEqual(getFaceBlend(happiness), { from: face, to: face, mix: 0 });
});

test("the compatibility blend helper always selects exactly one face without opacity mixing", () => {
  for (let happiness = -10; happiness <= 110; happiness += 0.1) {
    const blend = getFaceBlend(happiness);
    assert.equal(blend.mix, 0);
    assert.equal(blend.from, blend.to);
    assert.ok(["normal", "neutral", "displeased", "angry", "abandoned"].includes(blend.to));
  }
  for (const value of [undefined, null, NaN, Infinity, "0"]) assert.deepEqual(getFaceBlend(value), getFaceBlend(100));
});

test("the sprite renders a single registered face overlay without inline opacity", async () => {
  const source = await readFile(new URL("./SxbertySprite.jsx", import.meta.url), "utf8");
  const faceLayer = source.match(/<span className="sxberty-face-layers">([\s\S]*?)<\/span>/)?.[1];
  assert.ok(faceLayer, "The registered face layer remains present");
  assert.equal((faceLayer.match(/<img\b/g) || []).length, 1);
  assert.match(faceLayer, /src=\{faces\[to\]\}/);
  assert.doesNotMatch(faceLayer, /opacity|transition|mix/);
});

test("death expressions are one worse than the pre-loss happiness phase", () => {
  for (const [happiness, face] of [
    [100, "neutral"], [80.01, "neutral"], [80, "displeased"], [60, "displeased"], [59.99, "angry"],
    [40, "angry"], [39.99, "abandoned"], [20, "abandoned"], [19.99, "abandoned"], [0, "abandoned"],
  ]) assert.equal(getDeathFace(happiness), face);
  for (const invalid of [undefined, null, NaN, Infinity, "0"]) assert.equal(getDeathFace(invalid), "neutral");
});

test("a temporary forced face selects one overlay without changing happiness", () => {
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
  for (const [happiness, phase] of [[100,"happy"],[80.01,"happy"],[80,"uneasy"],[79.9,"uneasy"],[60,"uneasy"],[59.9,"neutral"],[40,"neutral"],[39.9,"upset"],[20,"upset"],[19.9,"angry"],[0.01,"angry"],[0,"abandoned"]]) {
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
