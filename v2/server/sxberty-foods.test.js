import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import sharp from "sharp";
import {
  SXBERTY_FOOD_MAX_BYTES, validateSxbertyFoodCreate, validateSxbertyFoodPatch,
  toSxbertyFoodDto, normalizePublicFood
} from "../shared/sxberty-foods.js";

// Never use the application's configured database for tests.
const databaseUrl = process.env.TEST_SXBERTY_DATABASE_URL || "";
if (databaseUrl && new URL(databaseUrl).pathname !== "/sxber_sxberty_test") throw new Error("Use a disposable sxber_sxberty_test database");
process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_SSL = "false";
process.env.INTERNAL_API_TOKEN = "local-sxberty-food-test-only";
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sxberty-food-test-"));
process.env.SXBERTY_FOOD_STORAGE_DIR = path.join(scratch, "actual-server");
const db = await import("./db.js");
const { createSxbertyFoodStore, prepareSxbertyFoodPng } = await import("./sxberty-foods.js");
const { registerSxbertyFoodRoutes } = await import("./sxberty-food-routes.js");
const { listAdminActivity } = await import("./auth.js");
const metadata = { name: "Pear", fullness: 20, happiness: 10, energy: 5 };
const png = await sharp({ create: { width: 1024, height: 512, channels: 4, background: { r: 70, g: 180, b: 50, alpha: 0.5 } } }).png().withMetadata().toBuffer();
const adminHeaders = { "x-test-admin": "yes", "content-type": "application/json" };
const localStore = name => createSxbertyFoodStore({ database: false, storageDir: path.join(scratch, name) });

before(async () => { if (databaseUrl) await db.initializeDatabase(); });
after(async () => { await db.closeDatabase(); await fs.rm(scratch, { recursive: true, force: true }); });
async function serve(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}
function routeApp(store, events = [], overrides = {}) {
  const app = express();
  registerSxbertyFoodRoutes(app, (request, response, next) => {
    if (request.get("x-test-admin") !== "yes") return response.status(401).json({ error: "Login required" });
    request.adminUser = { id: "food-test-admin" };
    next();
  }, { list: store.list, create: store.create, update: store.update, remove: store.delete, image: store.image,
    audit: async (request, event) => events.push({ actor: request.adminUser.id, ...event }), ...overrides });
  return app;
}
function uploadForm(bytes = png, changes = {}, mime = "image/png") {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...metadata, ...changes })) form.append(key, String(value));
  form.append("file", new Blob([bytes], { type: mime }), "untrusted-name.png");
  return form;
}
const post = (base, form, headers = { "x-test-admin": "yes" }) => fetch(`${base}/api/admin/sxberty-foods`, { method: "POST", headers, body: form });

const invalidPatches = [
  null, [], "food", {}, { ignored: true }, { image_data: "private" }, { id: randomUUID() },
  { name: "" }, { name: "  " }, { name: "x".repeat(81) }, { name: "secret\nname" }, { name: "bad\u202ename" },
  { enabled: 1 }, { enabled: "true" }, { fullness: -1 }, { happiness: 101 }, { energy: 0.5 },
  { fullness: "10" }, { happiness: null }, { energy: NaN }, { energy: Infinity }
];

test("strict metadata accepts bounded integers, trims names and rejects unexpected plain-object properties", () => {
  assert.deepEqual(validateSxbertyFoodCreate({ ...metadata, name: " Pear " }), { ...metadata, enabled: true });
  assert.deepEqual(validateSxbertyFoodPatch({ fullness: 0, happiness: 100, energy: 1, enabled: false }), { fullness: 0, happiness: 100, energy: 1, enabled: false });
  for (const body of invalidPatches) assert.throws(() => validateSxbertyFoodPatch(body), { status: 400 });
  for (const key of ["name", "fullness", "happiness", "energy"]) {
    const body = { ...metadata }; delete body[key];
    assert.throws(() => validateSxbertyFoodCreate(body), { status: 400 });
  }
  assert.throws(() => validateSxbertyFoodPatch(Object.create({ name: "inherited" })), { status: 400 });
  assert.throws(() => validateSxbertyFoodPatch({ [Symbol("hidden")]: 1 }), { status: 400 });
  assert.throws(() => validateSxbertyFoodPatch(Object.defineProperty({}, "name", { get() { throw new Error("getter evaluated"); } })), { status: 400 });
  assert.throws(() => validateSxbertyFoodPatch(JSON.parse('{"__proto__":{"enabled":true}}')), { status: 400 });
});

test("public DTO and forgiving client normalizer exclude all private data and untrusted URLs", () => {
  const id = randomUUID();
  const dto = toSxbertyFoodDto({ id, ...metadata, enabled: true, image_data: Buffer.from("private"), secret: true });
  assert.deepEqual(Object.keys(dto).sort(), ["id", "name", "enabled", "fullness", "happiness", "energy", "url"].sort());
  assert.equal(dto.url, `/api/sxberty-foods/${id}/image`);
  assert.deepEqual(normalizePublicFood({ ...dto, adminPreviewUrl: "/private", extra: true }), dto);
  for (const item of [null, {}, { ...dto, enabled: false }, { ...dto, energy: "5" }, { ...dto, id: "../secret" }, { ...dto, url: "https://elsewhere.invalid/pixel" }]) {
    assert.equal(normalizePublicFood(item), null);
  }
});

test("PNG magic, pixel dimensions, malformed inputs, animation and byte limits are enforced; output strips metadata and preserves alpha", async () => {
  const result = await prepareSxbertyFoodPng(png);
  const output = await sharp(result.data).metadata();
  assert.equal(output.format, "png");
  assert.equal(output.width, 512); assert.equal(output.height, 256); assert.equal(output.hasAlpha, true);
  assert.equal(output.exif, undefined); assert.equal(output.icc, undefined); assert.equal(output.xmp, undefined);
  const { data: pixels, info } = await sharp(result.data).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4); assert.ok(pixels[3] > 0 && pixels[3] < 255);
  const jpeg = await sharp(png).jpeg().toBuffer();
  const wide = await sharp({ create: { width: 2049, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  const tall = await sharp({ create: { width: 1, height: 2049, channels: 3, background: "red" } }).png().toBuffer();
  const oversized = await sharp({ create: { width: 2049, height: 2049, channels: 3, background: "red" } }).png().toBuffer();
  const animationChunk = Buffer.alloc(20); animationChunk.writeUInt32BE(8, 0); animationChunk.write("acTL", 4); animationChunk.writeUInt32BE(2, 8);
  const animated = Buffer.concat([png.subarray(0, 33), animationChunk, png.subarray(33)]);
  for (const bytes of [null, Buffer.alloc(0), Buffer.from("<svg/>"), jpeg, png.subarray(0, 8), png.subarray(0, -1), wide, tall, oversized, animated]) {
    await assert.rejects(prepareSxbertyFoodPng(bytes), { status: 400 });
  }
  await assert.rejects(prepareSxbertyFoodPng(Buffer.alloc(SXBERTY_FOOD_MAX_BYTES + 1)), { status: 413 });
  const tiny = await sharp({ create: { width: 2, height: 3, channels: 4, background: "transparent" } }).png().toBuffer();
  const tinyResult = await prepareSxbertyFoodPng(tiny);
  assert.equal(tinyResult.width, 2); assert.equal(tinyResult.height, 3);
});

test("empty filesystem catalog has no invented defaults; roundtrip, concurrent partial edits, enabled suppression and deletion are atomic across instances", async () => {
  const store = localStore("roundtrip");
  const second = localStore("roundtrip");
  assert.deepEqual(await store.list(), []);
  await assert.rejects(fs.stat(path.join(scratch, "roundtrip")), { code: "ENOENT" });
  const item = await store.create(png, metadata);
  assert.deepEqual(await second.list(true), [item]);
  assert.ok((await second.image(item.id)).data.equals((await prepareSxbertyFoodPng(png)).data));
  await Promise.all([store.update(item.id, { fullness: 70 }), second.update(item.id, { happiness: 80 }), store.update(item.id, { energy: 90 })]);
  const changed = (await second.list(true))[0];
  assert.deepEqual([changed.fullness, changed.happiness, changed.energy], [70, 80, 90]);
  await store.update(item.id, { enabled: false });
  assert.deepEqual(await store.list(), []); assert.equal(await second.image(item.id), null);
  assert.ok((await store.image(item.id, true)).data.length);
  assert.equal((await store.list(true))[0].enabled, false);
  assert.equal((await second.delete(item.id)).name, "Pear");
  assert.deepEqual(await store.list(true), []); assert.equal(await second.image(item.id, true), null);
  for (const id of ["../private", "../private.json", "", "A".repeat(36)]) {
    await assert.rejects(store.update(id, { name: "bad" }), { status: 404 });
    await assert.rejects(store.delete(id), { status: 404 });
    await assert.rejects(store.image(id), { status: 404 });
  }
  await assert.rejects(store.delete(item.id), { status: 404 });
  assert.deepEqual(await fs.readdir(path.join(scratch, "roundtrip")), []);
});

test("concurrent creates/deletes retain independent foods, file failures do not poison the queue, and corrupt records are not overwritten", async () => {
  const store = localStore("parallel");
  const second = localStore("parallel");
  const items = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? store : second).create(png, { ...metadata, name: `Food ${index}` })));
  assert.equal((await second.list(true)).length, 8);
  await Promise.all(items.map((item, index) => (index % 2 ? store : second).delete(item.id)));
  assert.deepEqual(await store.list(true), []);
  const blocked = path.join(scratch, "blocked");
  await fs.writeFile(blocked, "not a directory");
  const broken = createSxbertyFoodStore({ storageDir: blocked, database: false });
  await assert.rejects(broken.create(png, metadata));
  await fs.unlink(blocked);
  const created = await broken.create(png, metadata);
  assert.equal((await broken.list()).length, 1);
  const record = path.join(blocked, `${created.id}.json`);
  await fs.writeFile(record, "{broken");
  await assert.rejects(broken.list());
  await assert.rejects(broken.update(created.id, { name: "replacement" }));
  assert.equal(await fs.readFile(record, "utf8"), "{broken");
});

test("configured but unready or failed database never falls back to filesystem for any operation", async () => {
  let ready = false;
  let queries = 0;
  const storageDir = path.join(scratch, "no-fallback");
  const store = createSxbertyFoodStore({ storageDir, db: {
    isDatabaseConfigured: () => true, isDatabaseReady: () => ready,
    query: async () => { queries += 1; throw new Error("private database failure"); }
  } });
  const id = randomUUID();
  const operations = [() => store.list(), () => store.image(id), () => store.create(png, metadata), () => store.update(id, { energy: 20 }), () => store.delete(id)];
  for (const operation of operations) await assert.rejects(operation(), /Database is not ready/);
  assert.equal(queries, 0);
  ready = true;
  for (const operation of operations) await assert.rejects(operation(), /private database failure/);
  assert.equal(queries, operations.length);
  await assert.rejects(fs.stat(storageDir), { code: "ENOENT" });
});

test("HTTP authenticates before multipart parsing, requires JSON PATCH, rejects invalid metadata, and ignores browser MIME", async t => {
  const events = [];
  let creates = 0;
  const store = localStore("validation-http");
  const base = await serve(t, routeApp(store, events, { create: (...args) => { creates += 1; return store.create(...args); } }));
  const admin = `${base}/api/admin/sxberty-foods`;
  const missingId = randomUUID();
  for (const [method, suffix] of [["GET", ""], ["POST", ""], ["PATCH", `/${missingId}`], ["DELETE", `/${missingId}`], ["GET", `/${missingId}/image`]]) {
    const response = await fetch(`${admin}${suffix}`, { method, headers: { "content-type": "multipart/form-data; boundary=broken" }, ...(method === "POST" ? { body: "not multipart" } : {}) });
    assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const [method, suffix] of [["POST", ""], ["PATCH", `/${missingId}`]]) {
    for (const body of ['{"private":', JSON.stringify({ name: "x".repeat(8192) })]) {
      const response = await fetch(`${admin}${suffix}`, { method, headers: { "content-type": "application/json" }, body });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  assert.equal(creates, 0);
  assert.equal((await fetch(admin, { method: "POST", headers: adminHeaders, body: "{}" })).status, 415);
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    const response = await fetch(`${admin}/${missingId}`, { method: "PATCH", headers: { ...adminHeaders, "content-type": type }, body: '{"name":"Pear"}' });
    assert.equal(response.status, 415);
  }
  for (const body of invalidPatches) {
    assert.equal((await fetch(`${admin}/${missingId}`, { method: "PATCH", headers: adminHeaders, body: JSON.stringify(body) })).status, 400);
  }
  const malformed = await fetch(`${admin}/${missingId}`, { method: "PATCH", headers: adminHeaders, body: '{"private":' });
  assert.equal(malformed.status, 400); assert.equal(malformed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await malformed.json(), { error: "Send a valid JSON request body" });
  const oversizedJson = await fetch(`${admin}/${missingId}`, { method: "PATCH", headers: adminHeaders, body: JSON.stringify({ name: "x".repeat(8192) }) });
  assert.equal(oversizedJson.status, 413); assert.equal(oversizedJson.headers.get("cache-control"), "no-store");
  assert.deepEqual(await oversizedJson.json(), { error: "Send a valid JSON request body" });
  for (const changes of [{ happiness: "1.5" }, { energy: "-1" }, { fullness: "101" }, { fullness: "1e1" }, { name: "bad\nname" }, { enabled: "1" }, { unexpected: "private" }]) {
    assert.equal((await post(base, uploadForm(png, changes))).status, 400);
  }
  const duplicate = uploadForm(); duplicate.append("energy", "5");
  assert.equal((await post(base, duplicate)).status, 400);
  assert.equal((await post(base, uploadForm(Buffer.from("fake"), {}, "image/png"))).status, 400);
  assert.equal((await post(base, uploadForm(Buffer.alloc(SXBERTY_FOOD_MAX_BYTES + 1)))).status, 413);
  assert.deepEqual(events, []);
  // Neither filename nor browser-supplied MIME determines the image type.
  const response = await post(base, uploadForm(png, {}, "application/octet-stream"));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).item.name, "Pear");
});

test("HTTP roundtrip keeps catalog public metadata only, disabled images private, merges patches, and audits upload/update/delete", async t => {
  const store = localStore("roundtrip-http");
  const events = [];
  const base = await serve(t, routeApp(store, events, { list: async admin => (await store.list(admin)).map(item => ({ ...item, image_data: "private", secret: true })) }));
  const empty = await fetch(`${base}/api/sxberty-foods`);
  assert.deepEqual(await empty.json(), { items: [] }); assert.equal(empty.headers.get("cache-control"), "no-cache");
  const created = await post(base, uploadForm(png, { name: " Pear " }));
  assert.equal(created.status, 201); assert.equal(created.headers.get("cache-control"), "no-store");
  const item = (await created.json()).item;
  const url = `${base}/api/admin/sxberty-foods/${item.id}`;
  assert.deepEqual(await (await fetch(`${base}/api/sxberty-foods`)).json(), { items: [toSxbertyFoodDto(item)] });
  const publicImage = await fetch(`${base}${item.url}`);
  assert.equal(publicImage.status, 200); assert.match(publicImage.headers.get("content-type"), /image\/png/);
  assert.equal(publicImage.headers.get("cache-control"), "no-cache"); assert.equal(publicImage.headers.get("x-content-type-options"), "nosniff");
  assert.ok(Buffer.from(await publicImage.arrayBuffer()).equals((await store.image(item.id)).data));
  const edits = await Promise.all([{ happiness: 40 }, { energy: 60 }].map(body => fetch(url, { method: "PATCH", headers: adminHeaders, body: JSON.stringify(body) })));
  assert.deepEqual(edits.map(response => response.status), [200, 200]);
  const disabled = await fetch(url, { method: "PATCH", headers: adminHeaders, body: '{"enabled":false}' });
  assert.equal(disabled.status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/sxberty-foods`)).json(), { items: [] });
  assert.equal((await fetch(`${base}${item.url}?admin=true&original=1`)).status, 404);
  assert.equal((await fetch(`${base}${item.adminPreviewUrl}`)).status, 401);
  const preview = await fetch(`${base}${item.adminPreviewUrl}`, { headers: adminHeaders });
  assert.equal(preview.status, 200); assert.equal(preview.headers.get("cache-control"), "no-store");
  const adminList = await fetch(`${base}/api/admin/sxberty-foods`, { headers: adminHeaders });
  assert.equal(adminList.headers.get("cache-control"), "no-store");
  const edited = (await adminList.json()).items[0];
  assert.deepEqual([edited.fullness, edited.happiness, edited.energy, edited.enabled], [20, 40, 60, false]);
  assert.equal(edited.secret, undefined); assert.equal(edited.image_data, undefined);
  const deleted = await fetch(url, { method: "DELETE", headers: adminHeaders });
  assert.equal(deleted.status, 200); assert.deepEqual(await deleted.json(), { ok: true });
  assert.equal((await fetch(`${base}${item.adminPreviewUrl}`, { headers: adminHeaders })).status, 404);
  assert.equal((await fetch(url, { method: "DELETE", headers: adminHeaders })).status, 404);
  assert.equal(events.length, 5);
  assert.deepEqual(events.map(event => event.action), ["sxberty.food.upload", "sxberty.food.update", "sxberty.food.update", "sxberty.food.update", "sxberty.food.delete"]);
  for (const event of events) {
    assert.equal(event.actor, "food-test-admin"); assert.equal(event.resourceType, "sxberty-food"); assert.equal(event.resourceId, item.id); assert.equal(event.metadata.name, "Pear");
    assert.equal(event.metadata.image_data, undefined);
  }
  assert.deepEqual(events.slice(1, 3).flatMap(event => event.metadata.fields).sort(), ["energy", "happiness"]);
  assert.deepEqual(events.at(-1).metadata, { name: "Pear" });
});

test("every valid operation against unavailable storage returns generic 503 without an audit", async t => {
  const events = [];
  const failure = async () => { throw new Error("private connection details"); };
  const base = await serve(t, routeApp({ list: failure, create: failure, update: failure, delete: failure, image: failure }, events));
  const id = randomUUID();
  for (const [route, method, body] of [
    ["/api/sxberty-foods", "GET"], ["/api/admin/sxberty-foods", "GET"],
    [`/api/sxberty-foods/${id}/image`, "GET"], [`/api/admin/sxberty-foods/${id}/image`, "GET"],
    [`/api/admin/sxberty-foods/${id}`, "PATCH", '{"energy":10}'], [`/api/admin/sxberty-foods/${id}`, "DELETE"]
  ]) {
    const response = await fetch(`${base}${route}`, { method, headers: adminHeaders, body });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), route.includes("/admin/") ? "no-store" : "no-cache");
    assert.deepEqual(await response.json(), { error: "Sxberty foods are temporarily unavailable" });
  }
  const response = await post(base, uploadForm());
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "Sxberty foods are temporarily unavailable" });
  assert.deepEqual(events, []);
});

test("real server registers food routes before SPA and uses existing internal-key authentication and activity ledger", async t => {
  const { app } = await import("./index.js");
  const base = await serve(t, app);
  const headers = { "x-internal-api-key": process.env.INTERNAL_API_TOKEN };
  const endpoint = `${base}/api/admin/sxberty-foods`;
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { headers: { "x-internal-api-key": "wrong" } })).status, 401);
  const list = await fetch(`${base}/api/sxberty-foods`);
  assert.equal(list.status, 200); assert.match(list.headers.get("content-type"), /application\/json/);
  assert.ok(Array.isArray((await list.json()).items));
  const missingId = randomUUID();
  // These would previously fail in the global JSON parser before authentication.
  for (const [method, suffix] of [["POST", ""], ["PATCH", `/${missingId}`]]) {
    for (const body of ['{"private":', JSON.stringify({ name: "x".repeat(1024 * 1024 + 1) })]) {
      const denied = await fetch(`${endpoint}${suffix}`, { method, headers: { "content-type": "application/json" }, body });
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get("cache-control"), "no-store");
      assert.notEqual(denied.headers.get("ratelimit-remaining"), null);
    }
  }
  let previousRemaining;
  for (const [method, suffix, body, status] of [
    ["POST", "", '{"private":', 415],
    ["PATCH", `/${missingId}`, '{"private":', 400],
    ["PATCH", `/${missingId}`, JSON.stringify({ name: "x".repeat(8192) }), 413]
  ]) {
    const rejected = await fetch(`${endpoint}${suffix}`, { method, headers: { ...headers, "content-type": "application/json" }, body });
    assert.equal(rejected.status, status);
    assert.equal(rejected.headers.get("cache-control"), "no-store");
    assert.notEqual(rejected.headers.get("ratelimit-remaining"), null);
    const remaining = Number(rejected.headers.get("ratelimit-remaining"));
    assert.ok(Number.isInteger(remaining) && remaining > 0);
    if (previousRemaining !== undefined) assert.equal(remaining, previousRemaining - 1);
    previousRemaining = remaining;
  }
  const response = await post(base, uploadForm(), headers);
  assert.equal(response.status, 201);
  const item = (await response.json()).item;
  t.after(async () => {
    if (db.isDatabaseReady()) {
      await db.query("DELETE FROM sxberty_foods WHERE id = $1", [item.id]);
      await db.query("DELETE FROM admin_activity WHERE resource_type = 'sxberty-food' AND resource_id = $1", [item.id]);
    }
  });
  const edited = await fetch(`${endpoint}/${item.id}`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: '{"happiness":25}' });
  assert.equal(edited.status, 200);
  assert.equal((await fetch(`${endpoint}/${item.id}`, { method: "DELETE", headers })).status, 200);
  const events = (await listAdminActivity()).filter(event => event.resourceId === item.id);
  assert.deepEqual(events.map(event => event.action).sort(), ["sxberty.food.delete", "sxberty.food.update", "sxberty.food.upload"]);
  assert.deepEqual(events.find(event => event.action === "sxberty.food.update").metadata, { name: "Pear", fields: ["happiness"] });
});

test("optional disposable PostgreSQL stores PNG bytes and atomically merges concurrent partial metadata updates", { skip: !databaseUrl }, async t => {
  const first = createSxbertyFoodStore();
  const second = createSxbertyFoodStore();
  const item = await first.create(png, metadata);
  t.after(() => db.query("DELETE FROM sxberty_foods WHERE id = $1", [item.id]));
  const stored = (await db.query("SELECT image_data, width, height FROM sxberty_foods WHERE id = $1", [item.id])).rows[0];
  assert.ok(Buffer.isBuffer(stored.image_data)); assert.deepEqual([stored.width, stored.height], [512, 256]);
  await Promise.all([first.update(item.id, { fullness: 75 }), second.update(item.id, { happiness: 85 }), first.update(item.id, { energy: 95 })]);
  assert.deepEqual((await first.list(true)).find(entry => entry.id === item.id), { ...item, fullness: 75, happiness: 85, energy: 95 });
  await second.update(item.id, { enabled: false });
  assert.equal((await first.list()).some(entry => entry.id === item.id), false);
  assert.equal(await first.image(item.id), null);
  assert.ok((await second.image(item.id, true)).data.equals(stored.image_data));
  await assert.rejects(db.query("UPDATE sxberty_foods SET energy = 101 WHERE id = $1", [item.id]), error => error.code === "23514");
  await first.delete(item.id);
  assert.equal(await second.image(item.id, true), null);
});
