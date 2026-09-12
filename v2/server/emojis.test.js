import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { throwVelocity } from "../src/floating-emojis.js";
import { createEmojiUnlockTracker, hasEmojiUnlock, emojiUnlockCookie } from "../src/emoji-unlock.js";
import { markdownToHtml } from "../src/markdown.js";

test("throw speed uses recent movement, is capped, and stationary releases stop", () => {
  assert.deepEqual(throwVelocity([]), { x: 0, y: 0 });
  assert.deepEqual(throwVelocity([{ x: 0, y: 0, time: 0 }, { x: 200, y: -200, time: 20 }]), { x: 12, y: -12 });
  assert.deepEqual(throwVelocity([{ x: 0, y: 0, time: 0 }, { x: 200, y: 200, time: 1000 }]), { x: 0, y: 0 });
  assert.equal(markdownToHtml('<img src=x onerror="alert(1)"> **Hello**').includes("<img"), false);
  assert.ok(markdownToHtml("**Hello**").includes("<strong>Hello</strong>"));
});

test("emoji easter egg needs ten of one action and unlocks only once", () => {
  for (const trigger of ["click", "hover", "drag"]) {
    let unlocks = 0;
    const interact = createEmojiUnlockTracker(() => unlocks++);
    interact("pointerdown");
    for (const action of ["click", "hover", "drag"]) {
      for (let i = 0; i < 9; i++) interact(action);
      assert.equal(unlocks, 0, "Counts are separate; nine of each does not unlock");
    }
    interact(trigger);
    assert.equal(unlocks, 1);
    for (let i = 0; i < 20; i++) interact("click");
    interact("drag"); interact("hover");
    assert.equal(unlocks, 1, "No repeated toast after unlocking");
  }
  const restored = createEmojiUnlockTracker(() => assert.fail("Returning visitors should not get another toast"), true);
  restored("hover"); restored("drag");
  assert.equal(hasEmojiUnlock("unrelated=1; sxber-emoji-unlocked=1; another=2"), true);
  assert.equal(hasEmojiUnlock("sxber-emoji-unlocked=0"), false);
  assert.equal(hasEmojiUnlock("prefix-sxber-emoji-unlocked=1"), false);
  assert.equal(hasEmojiUnlock("sxber-emoji-unlocked=10"), false);
  assert.match(emojiUnlockCookie(false), /Path=\/; Max-Age=31536000; SameSite=Lax$/);
  assert.match(emojiUnlockCookie(true), /; Secure$/);
});

test("emoji API: upload, originals, editing, hidden assets, validation and audit", async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sxber-emoji-test-"));
  const database = process.env.TEST_EMBED_DATABASE_URL || "";
  if (database && new URL(database).pathname !== "/sxber_embed_test") throw new Error("Use a disposable sxber_embed_test database");
  process.env.DATABASE_URL = database;
  process.env.DATABASE_SSL = "false";
  process.env.EMOJI_STORAGE_DIR = scratch;
  process.env.INTERNAL_API_TOKEN = "local-emoji-test-only";
  const db = await import("./db.js");
  const emojis = await import("./emojis.js");
  let server;
  let previousSettings;
  let ledgerStart = 0;
  const ids = [];
  try {
    await db.initializeDatabase();
    previousSettings = await emojis.getEmojiSettings();
    if (db.isDatabaseReady()) ledgerStart = (await db.query("SELECT COALESCE(MAX(id),0) AS id FROM admin_activity")).rows[0].id;
    const { app } = await import("./index.js");
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { "x-internal-api-key": process.env.INTERNAL_API_TOKEN };
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const suffix = ["PATCH", "DELETE"].includes(method) ? "/123" : "";
      assert.equal((await fetch(`${base}/api/admin/emojis${suffix}`, { method })).status, 401);
    }
    const settingsUrl = `${base}/api/admin/emoji-settings`;
    assert.equal((await fetch(settingsUrl, { method: "PATCH" })).status, 401);
    const changeCount = count => fetch(settingsUrl, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ count }) });
    assert.deepEqual((await (await fetch(`${base}/api/emojis`)).json()).settings, previousSettings);
    for (const count of [-1, 31, 2.5, "5", null]) assert.equal((await changeCount(count)).status, 400);
    for (const count of [0, 1, 30, 7]) {
      assert.equal((await changeCount(count)).status, 200);
      assert.deepEqual(await emojis.getEmojiSettings(), { count });
      assert.deepEqual((await (await fetch(`${base}/api/emojis`)).json()).settings, { count });
      assert.deepEqual((await (await fetch(`${base}/api/admin/emojis`, { headers })).json()).settings, { count });
    }
    const original = await sharp({ create: { width: 512, height: 256, channels: 4, background: { r: 40, g: 120, b: 50, alpha: .5 } } }).png().toBuffer();
    const form = new FormData(); form.set("name", "Test emoji"); form.set("file", new Blob([original], { type: "image/png" }), "emoji.png");
    const uploaded = await fetch(`${base}/api/admin/emojis`, { method: "POST", headers, body: form });
    assert.equal(uploaded.status, 201); const item = (await uploaded.json()).item; ids.push(item.id);
    assert.equal(item.enabled, true);
    const image = await fetch(`${base}${item.url}`);
    assert.equal(image.headers.get("content-type"), "image/webp");
    const info = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    assert.equal(info.width, 256); assert.equal(info.height, 128); assert.equal(info.hasAlpha, true);
    const originalUrl = `${base}/api/admin/emojis/${item.id}/original`;
    assert.equal((await fetch(originalUrl)).status, 401);
    assert.deepEqual(Buffer.from(await (await fetch(originalUrl, { headers })).arrayBuffer()), original);
    const patch = body => fetch(`${base}/api/admin/emojis/${item.id}`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await patch({ links: ["javascript:alert(1)"] })).status, 400);
    assert.equal((await patch({ quotes: ["a".repeat(101)] })).status, 400);
    assert.equal((await patch({ heldQuotes: Array(31).fill("hi") })).status, 400);
    assert.equal((await patch({ enabled: "false" })).status, 400);
    assert.equal((await patch({ name: "" })).status, 400);
    const edited = await patch({ enabled: false, name: "Changed", quotes: [" **Hello** ", ""], heldQuotes: ["Wheee!"], fanartQuotes: ["Nice art!"], links: ["https://github.com/CelesteRed"] });
    assert.equal(edited.status, 200);
    const changed = (await edited.json()).item;
    assert.deepEqual(changed.quotes, ["**Hello**"]); assert.equal(changed.name, "Changed");
    assert.equal((await fetch(`${base}${item.url}`)).status, 404);
    assert.equal((await (await fetch(`${base}/api/emojis`)).json()).items.some(row => row.id === item.id), false);
    assert.equal((await (await fetch(`${base}/api/admin/emojis`, { headers })).json()).items.some(row => row.id === item.id), true);
    assert.equal((await fetch(originalUrl, { headers })).status, 200);
    await patch({ enabled: true });
    assert.equal((await fetch(`${base}${item.url}`)).status, 200);
    assert.equal((await fetch(`${base}/emojis/${"-".repeat(36)}.webp`)).status, 404);
    const bad = new FormData(); bad.set("name", "Invalid"); bad.set("file", new Blob(["<svg></svg>"], { type: "image/png" }), "bad.png");
    assert.equal((await fetch(`${base}/api/admin/emojis`, { method: "POST", headers, body: bad })).status, 400);
    // Two animation frames must survive conversion as well as the original bytes.
    const pixels = Buffer.concat([Buffer.alloc(40 * 40 * 3, 20), Buffer.alloc(40 * 40 * 3, 200)]);
    const animated = await sharp(pixels, { raw: { width: 40, height: 80, pageHeight: 40, channels: 3 } }).gif({ delay: [100, 100], loop: 0 }).toBuffer();
    assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
    const animation = await emojis.createEmoji(animated, { name: "Animated" }); ids.push(animation.id);
    assert.equal((await sharp((await emojis.emojiImage(animation.id)).data, { animated: true }).metadata()).pages, 2);
    assert.deepEqual((await emojis.emojiImage(animation.id, true)).data, animated);
    assert.equal((await fetch(`${base}/api/admin/emojis/${item.id}`, { method: "DELETE", headers })).status, 200);
    assert.equal(await emojis.emojiImage(item.id, true), null);
    assert.deepEqual(await emojis.getEmojiSettings(), { count: 7 }, "Uploads and removals preserve the global count");
    if (db.isDatabaseReady()) {
      assert.equal((await db.query("SELECT emoji_count FROM floating_emoji_settings WHERE id=1")).rows[0].emoji_count, 7);
      const settingsEvents = (await db.query("SELECT metadata FROM admin_activity WHERE action='emoji.settings' AND id > $1 ORDER BY id", [ledgerStart])).rows;
      assert.deepEqual(settingsEvents.map(row => row.metadata.count), [0, 1, 30, 7]);
      const rows = (await db.query("SELECT action FROM admin_activity WHERE resource_id=$1 ORDER BY id", [item.id])).rows;
      assert.deepEqual(rows.map(row => row.action), ["emoji.upload", "emoji.update", "emoji.update", "emoji.delete"]);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const id of ids) { await emojis.deleteEmoji(id).catch(() => {}); if (db.isDatabaseReady()) await db.query("DELETE FROM admin_activity WHERE resource_id=$1", [id]); }
    if (previousSettings) await emojis.updateEmojiSettings(previousSettings);
    if (db.isDatabaseReady()) await db.query("DELETE FROM admin_activity WHERE action='emoji.settings' AND id > $1", [ledgerStart]);
    await db.closeDatabase();
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
