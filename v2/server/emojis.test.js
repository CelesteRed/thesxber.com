import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { startFloatingEmojis, throwVelocity } from "../src/floating-emojis.js";
import { installEmojiParty } from "../src/emoji-party.js";
import { markdownToHtml } from "../src/markdown.js";

test("throw speed uses recent movement, is capped, and stationary releases stop", () => {
  assert.deepEqual(throwVelocity([]), { x: 0, y: 0 });
  assert.deepEqual(throwVelocity([{ x: 0, y: 0, time: 0 }, { x: 200, y: -200, time: 20 }]), { x: 12, y: -12 });
  assert.deepEqual(throwVelocity([{ x: 0, y: 0, time: 0 }, { x: 200, y: 200, time: 1000 }]), { x: 0, y: 0 });
  assert.equal(markdownToHtml('<img src=x onerror="alert(1)"> **Hello**').includes("<img"), false);
  assert.ok(markdownToHtml("**Hello**").includes("<strong>Hello</strong>"));
});

test("emojis start at zero without touching the DOM", () => {
  for (const count of [undefined, 0, -1, NaN]) {
    const cleanup = startFloatingEmojis(null, [{ name: "Party" }], "", false, count);
    assert.equal(typeof cleanup, "function");
    cleanup();
  }
});

test("console party requires a call, prints the note, and hints after five minutes", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const logs = [];
  let activations = 0;
  const host = { console: { log: text => logs.push(text) }, setTimeout, clearTimeout };
  const cleanup = installEmojiParty(host, () => activations++);
  const command = host.partyTime;
  assert.equal(typeof command, "function");
  assert.equal(activations, 0, "Reading the command must not activate motion");
  t.mock.timers.tick(299999);
  assert.deepEqual(logs, []);
  assert.equal(activations, 0, "Waiting does not activate emojis");
  t.mock.timers.tick(1);
  assert.deepEqual(logs, ["Type 'party time' for a fun time!", 'Run partyTime() or window["Party Time"]()']);
  for (const name of ["partyTime", "party time", "Party Time"]) host[name]();
  assert.equal(activations, 3);
  assert.deepEqual(logs.slice(2), Array(3).fill("Contact @CelesteRed on discord if any problems found on the site!"));
  t.mock.timers.tick(300000);
  assert.equal(logs.length, 5, "Hint appears once per installation");
  cleanup();
  assert.equal(Object.hasOwn(host, "partyTime"), false);
  assert.equal(Object.hasOwn(host, "party time"), false);
  assert.equal(Object.hasOwn(host, "Party Time"), false);
  command();
  assert.equal(activations, 3, "A retained command cannot activate an unmounted page");
});

test("console cleanup cancels hints and safely supports remounts", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const logs = [];
  const existing = () => {};
  const host = { console: { log: text => logs.push(text) }, setTimeout, clearTimeout, partyTime: existing };
  Object.defineProperty(host, "Party Time", { value: "reserved", configurable: false });
  const cleanup = installEmojiParty(host, () => assert.fail("No automatic activation"));
  assert.equal(host["Party Time"], "reserved");
  cleanup();
  assert.equal(host.partyTime, existing);
  t.mock.timers.tick(300000);
  assert.deepEqual(logs, []);
  const cleanupAgain = installEmojiParty(host, () => assert.fail("No automatic activation"));
  t.mock.timers.tick(300000);
  assert.equal(logs.length, 2, "Only the current installation prints a hint");
  const replacement = () => {};
  host.partyTime = replacement;
  cleanupAgain();
  assert.equal(host.partyTime, replacement, "Do not overwrite a newer command during cleanup");
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
