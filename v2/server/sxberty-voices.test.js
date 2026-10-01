import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import {
  SXBERTY_VOICE_MAX_BYTES, SXBERTY_VOICE_MAX_DURATION_MS, SXBERTY_VOICE_TRIGGERS,
  validateSxbertyVoiceCreate, validateSxbertyVoicePatch, toSxbertyVoiceDto, normalizePublicVoice
} from "../shared/sxberty-voices.js";

// Never touch the application's configured database. Optional PostgreSQL tests
// use the same explicitly disposable database guard as the companion tests.
const databaseUrl = process.env.TEST_SXBERTY_DATABASE_URL || "";
if (databaseUrl && new URL(databaseUrl).pathname !== "/sxber_sxberty_test") throw new Error("Use a disposable sxber_sxberty_test database");
process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_SSL = "false";
process.env.INTERNAL_API_TOKEN = "local-sxberty-voice-test-only";
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sxberty-voice-test-"));
process.env.SXBERTY_VOICE_STORAGE_DIR = path.join(scratch, "actual-server");
const db = await import("./db.js");
const { createSxbertyVoiceStore, prepareSxbertyVoiceMp3 } = await import("./sxberty-voices.js");
const { registerSxbertyVoiceRoutes } = await import("./sxberty-voice-routes.js");
const { listAdminActivity } = await import("./auth.js");
const metadata = { name: "Hello", enabled: true, trigger: "happy", caption: "Hello there!" };
const adminHeaders = { "x-test-admin": "yes", "content-type": "application/json" };
const localStore = name => createSxbertyVoiceStore({ database: false, storageDir: path.join(scratch, name) });

function frame({ version = 3, bitrate = 9, sample = 0, mono = false, padding = 0, crc = false } = {}) {
  const rates = version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rate = [44100, 48000, 32000][sample] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const size = Math.floor((version === 3 ? 144000 : 72000) * rates[bitrate] / rate) + padding;
  const result = Buffer.alloc(size);
  result.set([255, 0xe0 | (version << 3) | 2 | (crc ? 0 : 1), (bitrate << 4) | (sample << 2) | (padding << 1), mono ? 0xc0 : 0]);
  return result;
}
const mp3 = Buffer.concat([frame(), frame({ padding: 1 }), frame({ bitrate: 10 })]);
function id3(audio = mp3, { size = 40, version = 4, footer = false } = {}) {
  const header = Buffer.from([73, 68, 51, version, 0, footer ? 16 : 0, (size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127]);
  const tag = Buffer.alloc(size, 65); // Includes both tag content and padding.
  const foot = footer ? Buffer.concat([Buffer.from("3DI"), header.subarray(3)]) : Buffer.alloc(0);
  return Buffer.concat([header, tag, foot, audio]);
}
function tagged(audio = mp3) {
  const tail = Buffer.alloc(128);
  tail.write("TAGprivate title and artwork tags");
  return Buffer.concat([id3(audio), tail]);
}
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
  registerSxbertyVoiceRoutes(app, (request, response, next) => {
    if (request.get("x-test-admin") !== "yes") return response.status(401).json({ error: "Login required" });
    request.adminUser = { id: "voice-test-admin" };
    next();
  }, { list: store.list, create: store.create, update: store.update, remove: store.delete, audio: store.audio,
    audit: async (request, event) => events.push({ actor: request.adminUser.id, ...event }), ...overrides });
  return app;
}
function uploadForm(bytes = mp3, changes = {}, mime = "audio/mpeg") {
  const form = new FormData();
  for (const [key, value] of Object.entries({ ...metadata, ...changes })) form.append(key, String(value));
  form.append("file", new Blob([bytes], { type: mime }), "untrusted-name.bin");
  return form;
}
const post = (base, form, headers = { "x-test-admin": "yes" }) => fetch(`${base}/api/admin/sxberty-voices`, { method: "POST", headers, body: form });
const patch = (base, id, changes) => fetch(`${base}/api/admin/sxberty-voices/${id}`, { method: "PATCH", headers: adminHeaders, body: JSON.stringify(changes) });
const status = expected => error => error.status === expected;

test("metadata is strict, bounded plain text with an exact trigger allowlist and immutable derived fields", () => {
  assert.deepEqual(validateSxbertyVoiceCreate({ name: "  Hi  ", trigger: "food" }), { name: "Hi", trigger: "food", enabled: true, caption: "" });
  assert.deepEqual(validateSxbertyVoicePatch({ caption: "  " }), { caption: "" });
  assert.equal(validateSxbertyVoiceCreate({ name: "n".repeat(80), trigger: "happy", caption: "c".repeat(160) }).name.length, 80);
  assert.deepEqual(SXBERTY_VOICE_TRIGGERS.map(item => item.id), ["happy", "uneasy", "neutral", "upset", "angry", "abandoned", "throw", "food", "return-offscreen", "return-lava", "return-monster"]);
  const accessor = Object.defineProperty({}, "name", { get() { throw new Error("getter must not execute"); }, enumerable: true });
  for (const value of [null, [], "x", {}, new Date(), accessor, Object.create({ name: "x" }),
    { unknown: 1 }, { durationMs: 2 }, { duration_ms: 2 }, { url: "x" }, { audio_data: "x" },
    { [Symbol("name")]: "x" }, { enabled: "true" }, { enabled: 1 }, { trigger: "any" }, { trigger: "Happy" },
    { name: " " }, { name: "n".repeat(81) }, { caption: "c".repeat(161) }, { caption: null },
    ...["\0", "\n", "\t", "\u007f", "\u0085", "\u202e", "\u2066"].map(control => ({ name: `bad${control}` }))]) {
    assert.throws(() => validateSxbertyVoicePatch(value), status(400));
  }
  assert.throws(() => validateSxbertyVoiceCreate({ name: "Hi" }), status(400));
  assert.throws(() => validateSxbertyVoiceCreate({ trigger: "happy" }), status(400));
});

test("DTO and defensive public normalizer strip private data and reject untrusted media URLs", () => {
  const id = randomUUID();
  const stored = { id, ...metadata, duration_ms: 1000, audio_data: Buffer.from("private"), path: "/private", adminPreviewUrl: "evil", created_at: "private" };
  const dto = toSxbertyVoiceDto(stored);
  assert.deepEqual(Object.keys(dto).sort(), ["id", "name", "enabled", "trigger", "caption", "durationMs", "url"].sort());
  assert.deepEqual(normalizePublicVoice({ ...dto, audio_data: "secret", adminPreviewUrl: "evil" }), dto);
  for (const invalid of [null, { ...dto, enabled: false }, { ...dto, id: "../x" }, { ...dto, url: "https://evil/x.mp3" },
    { ...dto, url: `/api/admin/sxberty-voices/${id}/audio` }, { ...dto, trigger: "any" }, { ...dto, durationMs: 0 },
    { ...dto, durationMs: 30001 }, { ...dto, durationMs: 1.5 }, { ...dto, durationMs: undefined, duration_ms: 1000 }]) assert.equal(normalizePublicVoice(invalid), null);
  assert.equal(toSxbertyVoiceDto(stored, true).adminPreviewUrl, `/api/admin/sxberty-voices/${id}/audio`);
});

test("MP3 checks complete compatible MPEG Layer III frames, derives duration, and strips bounded ID3v2/v1", () => {
  const prepared = prepareSxbertyVoiceMp3(tagged());
  assert.ok(prepared.data.equals(mp3));
  assert.equal(prepared.durationMs, Math.ceil(3 * 1152 * 1000 / 44100));
  for (const version of [2, 3, 4]) assert.ok(prepareSxbertyVoiceMp3(id3(mp3, { version })).data.equals(mp3));
  assert.ok(prepareSxbertyVoiceMp3(id3(mp3, { footer: true })).data.equals(mp3));
  assert.ok(prepareSxbertyVoiceMp3(id3(mp3, { size: 512 * 1024 - 10 })).data.equals(mp3));
  for (const version of [0, 2, 3]) {
    const audio = Buffer.concat([frame({ version, mono: true, crc: true }), frame({ version, mono: true, crc: true, padding: 1 })]);
    assert.ok(prepareSxbertyVoiceMp3(audio).data.equals(audio));
  }
  const damagedFooter = id3(mp3, { footer: true }); damagedFooter[50] = 0;
  const nonsynchsafe = id3(); nonsynchsafe[6] = 128;
  const unsupportedVersion = id3(); unsupportedVersion[3] = 5;
  const reservedFlags = id3(); reservedFlags[5] = 1;
  const oversizedTag = id3(mp3, { size: 512 * 1024 });
  const truncatedTag = id3().subarray(0, 20);
  for (const bytes of [Buffer.alloc(0), Buffer.from("audio/mpeg"), Buffer.from("ID3"), frame(), mp3.subarray(0, -1),
    Buffer.concat([mp3, Buffer.from([0])]), Buffer.concat([Buffer.from("garbage"), mp3]), Buffer.concat([mp3, mp3.subarray(0, 3)]),
    id3(Buffer.alloc(0)), tagged(Buffer.alloc(0)), damagedFooter, nonsynchsafe, unsupportedVersion, reservedFlags, oversizedTag, truncatedTag,
    Buffer.concat([frame(), frame({ sample: 1 })]), Buffer.concat([frame(), frame({ mono: true })]), Buffer.concat([frame(), frame({ version: 2 })])]) assert.throws(() => prepareSxbertyVoiceMp3(bytes), status(400));
  for (const [index, mask, value] of [[1, 0x18, 0x08], [1, 0x06, 0x04], [2, 0xf0, 0], [2, 0xf0, 0xf0], [2, 0x0c, 0x0c], [3, 0x03, 2]]) {
    const damaged = Buffer.from(mp3); damaged[index] = (damaged[index] & ~mask) | value;
    assert.throws(() => prepareSxbertyVoiceMp3(damaged), status(400));
  }
  assert.throws(() => prepareSxbertyVoiceMp3(Buffer.alloc(SXBERTY_VOICE_MAX_BYTES + 1)), status(413));
  // 48 kHz MPEG-1 has exactly 24 ms per frame, so both sides of 30s are exact.
  const boundary = Buffer.concat(Array.from({ length: 1250 }, () => frame({ sample: 1 })));
  assert.equal(prepareSxbertyVoiceMp3(boundary).durationMs, SXBERTY_VOICE_MAX_DURATION_MS);
  assert.throws(() => prepareSxbertyVoiceMp3(Buffer.concat([boundary, frame({ sample: 1 })])), status(400));
});

test("the actual browser MP3 fixture is accepted without trusting its filename or MIME", async () => {
  const audio = await fs.readFile(new URL("../public/nextpageclick.mp3", import.meta.url));
  const prepared = prepareSxbertyVoiceMp3(audio);
  assert.equal(prepared.durationMs, 1032);
  assert.equal(prepared.data.length, 33024);
});

test("local CRUD is atomic across instances, strips metadata, suppresses disabled voices and merges concurrent patches", async () => {
  const first = localStore("crud"), second = localStore("crud");
  assert.deepEqual(await first.list(), []);
  await assert.rejects(first.create(mp3, { ...metadata, durationMs: 5 }), status(400));
  assert.deepEqual(await first.list(true), []);
  const item = await first.create(tagged(), metadata);
  assert.equal(item.durationMs, prepareSxbertyVoiceMp3(mp3).durationMs);
  assert.ok((await second.audio(item.id)).data.equals(mp3));
  await Promise.all([first.update(item.id, { name: "Edited" }), second.update(item.id, { caption: "New bubble" }), first.update(item.id, { trigger: "throw" })]);
  assert.deepEqual(await first.list(true), [{ ...item, name: "Edited", caption: "New bubble", trigger: "throw" }]);
  await second.update(item.id, { enabled: false });
  assert.deepEqual(await first.list(), []); assert.equal(await first.audio(item.id), null);
  assert.ok((await second.audio(item.id, true)).data.equals(mp3));
  assert.equal((await first.list(true))[0].enabled, false);
  const raw = JSON.parse(await fs.readFile(path.join(scratch, "crud", `${item.id}.json`), "utf8"));
  assert.ok(Buffer.from(raw.audio_data, "base64").equals(mp3));
  await first.delete(item.id);
  assert.equal(await second.audio(item.id, true), null);
  await assert.rejects(first.update(item.id, { caption: "x" }), status(404));
  await assert.rejects(first.delete(item.id), status(404));
  await assert.rejects(first.audio("../x"), status(404));
  assert.deepEqual((await fs.readdir(path.join(scratch, "crud"))).filter(file => file.endsWith(".tmp")), []);
});

test("concurrent record changes preserve independent voices and a failed queue does not poison later operations", async () => {
  const first = localStore("concurrent"), second = localStore("concurrent");
  const items = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? first : second).create(mp3, { ...metadata, name: `Voice ${index}` })));
  assert.equal((await second.list(true)).length, 8);
  await Promise.all(items.map(item => second.delete(item.id)));
  assert.deepEqual(await first.list(true), []);
  const item = await first.create(mp3, metadata);
  const file = path.join(scratch, "concurrent", `${item.id}.json`);
  await fs.writeFile(file, "corrupt");
  await assert.rejects(second.update(item.id, { name: "Must not overwrite" }));
  assert.equal(await fs.readFile(file, "utf8"), "corrupt");
  await fs.rm(file);
  assert.equal((await first.create(mp3, metadata)).name, "Hello");
  const blocked = path.join(scratch, "blocked-directory"); await fs.writeFile(blocked, "not a directory");
  const store = createSxbertyVoiceStore({ database: false, storageDir: blocked });
  await assert.rejects(store.create(mp3, metadata));
  await fs.rm(blocked);
  assert.equal((await store.create(mp3, metadata)).name, "Hello");
});

test("runtime readiness and query failures are fail-closed for every operation, never falling back to disk", async () => {
  const item = await localStore("readiness").create(mp3, metadata);
  let ready = false, calls = 0;
  const fakeDb = { isDatabaseConfigured: () => true, isDatabaseReady: () => ready, query: async () => { calls += 1; throw new Error("private DB details"); } };
  const store = createSxbertyVoiceStore({ storageDir: path.join(scratch, "readiness"), db: fakeDb });
  const operations = [() => store.list(), () => store.create(mp3, metadata), () => store.update(item.id, { caption: "x" }), () => store.delete(item.id), () => store.audio(item.id, true)];
  for (const operation of operations) await assert.rejects(operation, /not ready/);
  assert.equal(calls, 0);
  ready = true;
  for (const operation of operations) await assert.rejects(operation, /private DB details/);
  assert.equal(calls, 5);
  assert.deepEqual(await localStore("readiness").list(true), [item]);
});

test("HTTP authenticates before multipart/JSON allocation and strictly validates multipart metadata and read-only fields", async t => {
  const store = localStore("http-validation"), events = [];
  const base = await serve(t, routeApp(store, events));
  const id = randomUUID();
  for (const [method, suffix] of [["POST", ""], ["PATCH", `/${id}`]]) {
    for (const body of ['{"bad":', JSON.stringify({ name: "x".repeat(1024 * 1024 + 1) })]) {
      const response = await fetch(`${base}/api/admin/sxberty-voices${suffix}`, { method, headers: { "content-type": "application/json" }, body });
      assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  assert.equal((await fetch(`${base}/api/admin/sxberty-voices`, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=missing" }, body: "malformed" })).status, 401);
  assert.equal((await fetch(`${base}/api/admin/sxberty-voices`, { method: "POST", headers: adminHeaders, body: "{}" })).status, 415);
  for (const bytes of [Buffer.from("not an MP3"), mp3.subarray(0, -1), frame()]) assert.equal((await post(base, uploadForm(bytes))).status, 400);
  assert.equal((await post(base, uploadForm(Buffer.alloc(SXBERTY_VOICE_MAX_BYTES + 1)))).status, 413);
  for (const changes of [{ name: " " }, { enabled: "1" }, { trigger: "any" }, { caption: "x".repeat(161) }, { durationMs: 1 }, { name: "x".repeat(641) }]) assert.equal((await post(base, uploadForm(mp3, changes))).status, 400);
  const duplicate = uploadForm(); duplicate.append("name", "duplicate");
  assert.equal((await post(base, duplicate)).status, 400);
  const missingFile = new FormData(); missingFile.append("name", "x"); missingFile.append("trigger", "happy");
  assert.equal((await post(base, missingFile)).status, 400);
  const extraFile = uploadForm(); extraFile.append("file", new Blob([mp3]), "second.mp3");
  assert.equal((await post(base, extraFile)).status, 400);
  assert.deepEqual(await store.list(true), []); assert.deepEqual(events, []);
  for (const [body, contentType, expected] of [["{}", "text/plain", 415], ['{"bad":', "application/json", 400], [JSON.stringify({ name: "x".repeat(8192) }), "application/json", 413], ["[]", "application/json", 400], ['{"durationMs":2}', "application/json", 400]]) {
    const response = await fetch(`${base}/api/admin/sxberty-voices/${id}`, { method: "PATCH", headers: { "x-test-admin": "yes", "content-type": contentType }, body });
    assert.equal(response.status, expected); assert.equal(response.headers.get("cache-control"), "no-store");
  }
  // A deliberately incorrect browser type/name must not reject valid frames.
  assert.equal((await post(base, uploadForm(mp3, {}, "application/octet-stream"))).status, 201);
});

test("HTTP CRUD filters public metadata, protects disabled audio, and records only sanitized mutation audit fields", async t => {
  const events = [], store = localStore("http-crud");
  const base = await serve(t, routeApp(store, events));
  const created = await post(base, uploadForm(tagged())); assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  const item = (await created.json()).item;
  const publicList = await fetch(`${base}/api/sxberty-voices`); assert.equal(publicList.headers.get("cache-control"), "no-cache");
  const publicItem = (await publicList.json()).items[0];
  assert.deepEqual(publicItem, toSxbertyVoiceDto(item)); assert.equal(publicItem.adminPreviewUrl, undefined);
  assert.equal((await fetch(`${base}/api/admin/sxberty-voices`)).status, 401);
  const adminList = await fetch(`${base}/api/admin/sxberty-voices`, { headers: adminHeaders });
  assert.equal(adminList.headers.get("cache-control"), "no-store"); assert.deepEqual((await adminList.json()).items, [item]);
  const full = await fetch(`${base}${item.url}`); assert.equal(full.status, 200);
  assert.equal(full.headers.get("content-type"), "audio/mpeg"); assert.equal(full.headers.get("x-content-type-options"), "nosniff");
  assert.ok(Buffer.from(await full.arrayBuffer()).equals(mp3));
  assert.equal((await patch(base, item.id, { caption: "Updated", enabled: false })).status, 200);
  assert.deepEqual((await (await fetch(`${base}/api/sxberty-voices`)).json()).items, []);
  assert.equal((await fetch(`${base}${item.url}`, { headers: { range: "bytes=0-3" } })).status, 404);
  assert.equal((await fetch(`${base}${item.adminPreviewUrl}`)).status, 401);
  const privateAudio = await fetch(`${base}${item.adminPreviewUrl}`, { headers: adminHeaders });
  assert.equal(privateAudio.status, 200); assert.equal(privateAudio.headers.get("cache-control"), "no-store");
  assert.ok(Buffer.from(await privateAudio.arrayBuffer()).equals(mp3));
  assert.equal((await fetch(`${base}/api/admin/sxberty-voices/${item.id}`, { method: "DELETE", headers: adminHeaders })).status, 200);
  assert.equal((await fetch(`${base}${item.adminPreviewUrl}`, { headers: adminHeaders })).status, 404);
  assert.deepEqual(events.map(event => event.action), ["sxberty.voice.upload", "sxberty.voice.update", "sxberty.voice.delete"]);
  assert.ok(events.every(event => event.actor === "voice-test-admin" && event.resourceId === item.id && event.resourceType === "sxberty-voice"));
  assert.deepEqual(events[1].metadata, { name: "Hello", fields: ["caption", "enabled"] });
  assert.deepEqual(events[2].metadata, { name: "Hello" });
  assert.ok(events.every(event => !JSON.stringify(event).includes("Updated") && !JSON.stringify(event).includes("audio_data")));
});

test("audio supports bounded single byte ranges and native HEAD preview with correct 206/416 semantics", async t => {
  const store = localStore("ranges"), item = await store.create(mp3, metadata);
  const base = await serve(t, routeApp(store));
  for (const [range, start, end] of [["bytes=0-3", 0, 3], ["bytes=4-", 4, mp3.length - 1], ["bytes=-10", mp3.length - 10, mp3.length - 1], ["bytes=0-99999999", 0, mp3.length - 1], ["bytes=-99999999", 0, mp3.length - 1]]) {
    const response = await fetch(`${base}${item.url}`, { headers: { range } });
    assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${mp3.length}`);
    assert.equal(Number(response.headers.get("content-length")), end - start + 1);
    assert.equal(response.headers.get("accept-ranges"), "bytes"); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(mp3.subarray(start, end + 1)));
  }
  for (const range of [`bytes=${mp3.length}-`, "bytes=4-3", "bytes=-0", "bytes=-", "bytes=0-1,3-4", "bytes=9007199254740992-", "items=0-1", "bytes=0-" + "9".repeat(120)]) {
    const response = await fetch(`${base}${item.url}`, { headers: { range } });
    assert.equal(response.status, 416); assert.equal(response.headers.get("content-range"), `bytes */${mp3.length}`);
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
  for (const url of [item.url, item.adminPreviewUrl]) {
    for (const range of ["bytes=0-3", `bytes=${mp3.length}-`, "bytes=0-1,3-4"]) {
      const head = await fetch(`${base}${url}`, { method: "HEAD", headers: { ...adminHeaders, range } });
      assert.equal(head.status, 200);
      assert.equal(Number(head.headers.get("content-length")), mp3.length);
      assert.equal(head.headers.get("content-range"), null);
      assert.equal(head.headers.get("cache-control"), url === item.url ? "no-cache" : "no-store");
      assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
  }
  assert.equal((await fetch(`${base}${item.adminPreviewUrl}`, { method: "HEAD", headers: { range: "bytes=0-3" } })).status, 401);
  assert.equal((await fetch(`${base}${item.url}`, { headers: { range: "bytes=0-3", "if-range": '"unknown"' } })).status, 200);
});

test("unavailable storage yields generic 503 for every route without success audits", async t => {
  const events = [], fail = async () => { throw new Error("private filesystem/database information"); };
  const base = await serve(t, routeApp({}, events, { list: fail, create: fail, update: fail, remove: fail, audio: fail }));
  const id = randomUUID();
  const responses = [await fetch(`${base}/api/sxberty-voices`), await fetch(`${base}/api/admin/sxberty-voices`, { headers: adminHeaders }),
    await post(base, uploadForm()), await patch(base, id, { enabled: false }),
    await fetch(`${base}/api/admin/sxberty-voices/${id}`, { method: "DELETE", headers: adminHeaders }),
    await fetch(`${base}/api/sxberty-voices/${id}/audio`), await fetch(`${base}/api/admin/sxberty-voices/${id}/audio`, { headers: adminHeaders })];
  for (const response of responses) { assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "Sxberty voices are temporarily unavailable" }); }
  assert.deepEqual(events, []);
});

test("actual server wires voices before global parsing/SPA and applies rate limiting, admin authentication and audits", async t => {
  const { app } = await import("./index.js");
  const base = await serve(t, app), endpoint = `${base}/api/admin/sxberty-voices`;
  const headers = { "x-internal-api-key": process.env.INTERNAL_API_TOKEN };
  const id = randomUUID();
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { headers: { "x-internal-api-key": "wrong" } })).status, 401);
  const catalog = await fetch(`${base}/api/sxberty-voices`); assert.equal(catalog.status, 200); assert.ok(Array.isArray((await catalog.json()).items));
  for (const [method, suffix] of [["POST", ""], ["PATCH", `/${id}`]]) {
    for (const body of ['{"bad":', JSON.stringify({ name: "x".repeat(1024 * 1024 + 1) })]) {
      const response = await fetch(`${endpoint}${suffix}`, { method, headers: { "content-type": "application/json" }, body });
      assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store");
      assert.notEqual(response.headers.get("ratelimit-remaining"), null);
    }
  }
  let previousRemaining;
  for (const [method, suffix, body, expected] of [["POST", "", '{"bad":', 415], ["PATCH", `/${id}`, '{"bad":', 400], ["PATCH", `/${id}`, JSON.stringify({ name: "x".repeat(8192) }), 413]]) {
    const response = await fetch(`${endpoint}${suffix}`, { method, headers: { ...headers, "content-type": "application/json" }, body });
    assert.equal(response.status, expected); assert.equal(response.headers.get("cache-control"), "no-store");
    const remaining = Number(response.headers.get("ratelimit-remaining")); assert.ok(Number.isInteger(remaining) && remaining > 0);
    if (previousRemaining !== undefined) assert.equal(remaining, previousRemaining - 1);
    previousRemaining = remaining;
  }
  const created = await post(base, uploadForm(tagged()), headers); assert.equal(created.status, 201);
  const item = (await created.json()).item;
  t.after(async () => {
    if (db.isDatabaseReady()) {
      await db.query("DELETE FROM sxberty_voices WHERE id = $1", [item.id]);
      await db.query("DELETE FROM admin_activity WHERE resource_type = 'sxberty-voice' AND resource_id = $1", [item.id]);
    }
  });
  assert.equal((await fetch(`${base}${item.url}`, { headers: { range: "bytes=0-3" } })).status, 206);
  assert.equal((await fetch(`${endpoint}/${item.id}`, { method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: '{"caption":"Edited"}' })).status, 200);
  assert.equal((await fetch(`${endpoint}/${item.id}`, { method: "DELETE", headers })).status, 200);
  const events = (await listAdminActivity()).filter(event => event.resourceId === item.id);
  assert.deepEqual(events.map(event => event.action).sort(), ["sxberty.voice.delete", "sxberty.voice.update", "sxberty.voice.upload"]);
  assert.deepEqual(events.find(event => event.action === "sxberty.voice.update").metadata, { name: "Hello", fields: ["caption"] });
});

test("optional disposable PostgreSQL persists stripped audio bytes and atomically merges metadata-only changes", { skip: !databaseUrl }, async t => {
  const first = createSxbertyVoiceStore(), second = createSxbertyVoiceStore();
  const item = await first.create(tagged(), metadata);
  t.after(() => db.query("DELETE FROM sxberty_voices WHERE id = $1", [item.id]));
  const stored = (await db.query("SELECT audio_data, duration_ms FROM sxberty_voices WHERE id = $1", [item.id])).rows[0];
  assert.ok(Buffer.isBuffer(stored.audio_data)); assert.ok(stored.audio_data.equals(mp3)); assert.equal(stored.duration_ms, item.durationMs);
  await Promise.all([first.update(item.id, { name: "PG voice" }), second.update(item.id, { caption: "PG caption" }), first.update(item.id, { trigger: "return-lava" })]);
  assert.deepEqual((await first.list(true)).find(entry => entry.id === item.id), { ...item, name: "PG voice", caption: "PG caption", trigger: "return-lava" });
  await second.update(item.id, { enabled: false });
  assert.equal((await first.list()).some(entry => entry.id === item.id), false); assert.equal(await first.audio(item.id), null);
  assert.ok((await second.audio(item.id, true)).data.equals(mp3));
  for (const sql of ["UPDATE sxberty_voices SET duration_ms = 30001 WHERE id = $1", "UPDATE sxberty_voices SET trigger = 'any' WHERE id = $1", "UPDATE sxberty_voices SET caption = repeat('x', 161) WHERE id = $1"]) await assert.rejects(db.query(sql, [item.id]), error => error.code === "23514");
  await first.delete(item.id); assert.equal(await second.audio(item.id, true), null);
});
