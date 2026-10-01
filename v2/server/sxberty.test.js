import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import express from "express";
import { DEFAULT_SXBERTY_SETTINGS, SXBERTY_PHASES, getSxbertyPhase, normalizeSxbertySettings, validateSxbertyPatch } from "../shared/sxberty.js";

// Never connect tests to an implicitly configured application database.
const databaseUrl = process.env.TEST_SXBERTY_DATABASE_URL || "";
if (databaseUrl && new URL(databaseUrl).pathname !== "/sxber_sxberty_test") {
  throw new Error("Use a disposable sxber_sxberty_test database");
}
process.env.DATABASE_URL = databaseUrl;
process.env.DATABASE_SSL = "false";
process.env.INTERNAL_API_TOKEN = "local-sxberty-test-only";
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sxberty-test-"));
process.env.SXBERTY_STORAGE_DIR = path.join(scratch, "actual-server");
const db = await import("./db.js");
const { createSxbertyStore, getSxbertySettings } = await import("./sxberty.js");
const { registerSxbertyRoutes } = await import("./sxberty-routes.js");
const { listAdminActivity } = await import("./auth.js");

before(async () => { if (databaseUrl) await db.initializeDatabase(); });
after(async () => {
  await db.closeDatabase();
  await fs.rm(scratch, { recursive: true, force: true });
});

const defaults = () => normalizeSxbertySettings();
const localStore = name => createSxbertyStore({ database: false, storageDir: path.join(scratch, name) });
async function serve(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}
function routeApp(dependencies) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const requireAdmin = (request, response, next) => {
    if (request.get("x-test-admin") !== "yes") return response.status(401).json({ error: "Login required" });
    request.adminUser = { id: "test-admin" };
    next();
  };
  registerSxbertyRoutes(app, requireAdmin, dependencies);
  return app;
}
const adminHeaders = { "x-test-admin": "yes", "content-type": "application/json" };

const invalidBodies = [
  null, [], "hello", 7, true, {}, { phrases: null }, { phrases: [] }, { phrases: "happy" }, { phrases: {} },
  { phrases: { happy: ["Hello"] }, happiness: 100 }, { phrases: { unknown: ["Hello"] } },
  JSON.parse('{"phrases":{"__proto__":["Hello"]}}'), { phrases: { constructor: ["Hello"] } },
  { phrases: { happy: "Hello" } }, { phrases: { happy: null } }, { phrases: { happy: [42] } },
  { phrases: { happy: [null] } }, { phrases: { happy: [{}] } }, { phrases: { happy: [""] } },
  { phrases: { happy: ["   "] } }, { phrases: { happy: ["a".repeat(161)] } },
  { phrases: { happy: Array(21).fill("Hello") } },
  ...["\n", "\r", "\t", "\u0000", "\u001f", "\u007f", "\u0085", "\u2028", "\u2029"].map(character => ({ phrases: { happy: [`Hello${character}there`] } }))
];

test("phase boundaries and defaults reflect the complete Sxberty personality progression", () => {
  assert.deepEqual(SXBERTY_PHASES.map(({ id }) => id), ["happy", "uneasy", "neutral", "upset", "angry", "abandoned"]);
  for (const [happiness, phase] of [[100, "happy"], [80.01, "happy"], [80, "uneasy"], [79.99, "uneasy"], [60, "uneasy"], [59.99, "neutral"], [40, "neutral"], [39.99, "upset"], [20, "upset"], [19.99, "angry"], [0.01, "angry"], [0, "abandoned"], [-1, "abandoned"], [101, "happy"], [NaN, "happy"], [undefined, "happy"]]) {
    assert.equal(getSxbertyPhase(happiness), phase);
  }
  assert.deepEqual(validateSxbertyPatch(DEFAULT_SXBERTY_SETTINGS), DEFAULT_SXBERTY_SETTINGS);
  for (const { id } of SXBERTY_PHASES) {
    assert.ok(DEFAULT_SXBERTY_SETTINGS.phrases[id].length > 0);
    for (const phrase of DEFAULT_SXBERTY_SETTINGS.phrases[id]) {
      assert.match(phrase, /Sxberty/);
      assert.doesNotMatch(phrase, /Verity/i);
    }
  }
  const settings = defaults();
  settings.phrases.happy.push("local mutation");
  assert.notDeepEqual(settings, defaults(), "Returned arrays do not mutate shared defaults");
});

test("strict patches reject unknown fields, phase keys, types, bounds and control characters", () => {
  for (const body of invalidBodies) assert.throws(() => validateSxbertyPatch(body), { status: 400 });
  assert.throws(() => validateSxbertyPatch(Object.create({ phrases: { happy: ["inherited"] } })), { status: 400 });
  assert.throws(() => validateSxbertyPatch({ phrases: { happy: Array(1) } }), { status: 400 });
  assert.throws(() => validateSxbertyPatch({ phrases: { happy: ["good"] }, [Symbol("extra")]: true }), { status: 400 });
  assert.deepEqual(validateSxbertyPatch({ phrases: { happy: [" Hello "], abandoned: [] } }), { phrases: { happy: ["Hello"], abandoned: [] } });
  const boundary = { phrases: { uneasy: Array(20).fill(` ${"a".repeat(160)} `) } };
  assert.deepEqual(validateSxbertyPatch(boundary).phrases.uneasy, Array(20).fill("a".repeat(160)));
  assert.equal(boundary.phrases.uneasy[0].length, 162, "Validation does not mutate the caller's body");
  assert.deepEqual(validateSxbertyPatch({ phrases: { happy: ["<b>Sxberty</b>"] } }).phrases.happy, ["<b>Sxberty</b>"], "Markup-like input is literal text, not HTML");
});

test("normalization discards unknown data and repairs invalid phases independently", () => {
  for (const raw of [undefined, null, [], 1, {}, { phrases: null }, { phrases: [] }]) assert.deepEqual(normalizeSxbertySettings(raw), defaults());
  const raw = { secret: "private", phrases: { happy: [" Hello "], uneasy: [], angry: [false], neutral: ["x".repeat(161)], other: ["hidden"] } };
  assert.deepEqual(normalizeSxbertySettings(raw), { phrases: { ...defaults().phrases, happy: ["Hello"], uneasy: [] } });
  const poisoned = JSON.parse('{"phrases":{"__proto__":{"polluted":true}}}');
  assert.deepEqual(normalizeSxbertySettings(poisoned), defaults());
  assert.equal({}.polluted, undefined);
});

test("filesystem reads are side-effect free; malformed data recovers without rewriting", async () => {
  const storageDir = path.join(scratch, "read-only");
  const filename = path.join(storageDir, "settings.json");
  const store = localStore("read-only");
  assert.deepEqual(await store.read(), defaults());
  await assert.rejects(fs.stat(storageDir), { code: "ENOENT" });
  await fs.mkdir(storageDir);
  for (const content of ["{broken", "null", "[]", '{"phrases":{"happy":[123]}}']) {
    await fs.writeFile(filename, content);
    assert.deepEqual(await store.read(), defaults());
    assert.equal(await fs.readFile(filename, "utf8"), content);
  }
  const saved = await store.update({ phrases: { upset: [" Sxberty misses you. "] } });
  assert.deepEqual(saved, { phrases: { ...defaults().phrases, upset: ["Sxberty misses you."] } });
  assert.deepEqual(await localStore("read-only").read(), saved);
  assert.deepEqual(await fs.readdir(storageDir), ["settings.json"]);
});

test("queued atomic filesystem changes persist partial updates and empty arrays across store instances", async () => {
  const first = localStore("concurrent");
  const second = localStore("concurrent");
  const expected = defaults();
  await Promise.all(SXBERTY_PHASES.map(({ id }, index) => {
    const phrases = index ? [`Sxberty phase ${id}`] : [];
    expected.phrases[id] = phrases;
    return (index % 2 ? first : second).update({ phrases: { [id]: phrases } });
  }));
  assert.deepEqual(await first.read(), expected);
  assert.deepEqual(await localStore("concurrent").read(), expected);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(scratch, "concurrent/settings.json"), "utf8")), expected);
  await assert.rejects(first.update({ phrases: { happy: ["bad\nphrase"] } }), { status: 400 });
  assert.deepEqual(await first.read(), expected);
  const updated = await second.update({ phrases: { angry: ["Sxberty is waiting."] } });
  assert.deepEqual(updated, { phrases: { ...expected.phrases, angry: ["Sxberty is waiting."] } });
  assert.deepEqual(await fs.readdir(path.join(scratch, "concurrent")), ["settings.json"]);
});

test("filesystem I/O errors are not silently treated as defaults and failed writes do not poison the queue", async () => {
  const directory = path.join(scratch, "io-error");
  await fs.writeFile(directory, "not a directory");
  const store = localStore("io-error");
  await assert.rejects(store.read(), { code: "ENOTDIR" });
  await assert.rejects(store.update({ phrases: { happy: ["Sxberty"] } }), { code: "ENOTDIR" });
  await fs.rm(directory);
  assert.deepEqual((await store.update({ phrases: { happy: [] } })).phrases.happy, []);
});

test("configured database readiness and query failures never switch to local storage", async () => {
  const storageDir = path.join(scratch, "no-fallback");
  let ready = false;
  const queries = [];
  const database = {
    isDatabaseConfigured: () => true,
    isDatabaseReady: () => ready,
    query: async text => { queries.push(text); throw new Error("private connection details"); }
  };
  const store = createSxbertyStore({ storageDir, db: database });
  await assert.rejects(store.read(), /Database is not ready/);
  await assert.rejects(store.update({ phrases: { happy: [] } }), /Database is not ready/);
  assert.equal(queries.length, 0);
  ready = true;
  await assert.rejects(store.read(), /private connection details/);
  await assert.rejects(store.update({ phrases: { happy: [] } }), /private connection details/);
  await assert.rejects(fs.stat(storageDir), { code: "ENOENT" });
});

test("database reads only select and do not create a default singleton", async () => {
  const statements = [];
  const store = createSxbertyStore({ db: {
    isDatabaseConfigured: () => true,
    isDatabaseReady: () => true,
    query: async statement => { statements.push(statement); return { rows: [] }; }
  } });
  assert.deepEqual(await store.read(), defaults());
  assert.deepEqual(statements, ["SELECT phrases FROM sxberty_settings WHERE id = 1"]);
});

test("HTTP authorization, JSON-only mutation, strict validation, public payload and sanitized audit", async t => {
  const store = localStore("http");
  const events = [];
  let updates = 0;
  const app = routeApp({
    read: async () => ({ ...await store.read(), secret: "never public" }),
    update: async changes => { updates += 1; return store.update(changes); },
    audit: async (request, event) => events.push({ actor: request.adminUser.id, ...event })
  });
  const base = await serve(t, app);
  const url = `${base}/api/admin/sxberty`;
  for (const method of ["GET", "PATCH"]) {
    const response = await fetch(url, { method });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const initial = await fetch(`${base}/api/sxberty`);
  assert.equal(initial.headers.get("cache-control"), "no-cache");
  assert.deepEqual(await initial.json(), { settings: defaults() });
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
    const response = await fetch(url, { method: "PATCH", headers: { ...adminHeaders, "content-type": type }, body: '{"phrases":{"happy":[]}}' });
    assert.equal(response.status, 415);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await fetch(url, { method: "PATCH", headers: { "x-test-admin": "yes" } })).status, 415);
  for (const body of invalidBodies) {
    const response = await fetch(url, { method: "PATCH", headers: adminHeaders, body: JSON.stringify(body) });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const malformed = await fetch(url, { method: "PATCH", headers: adminHeaders, body: '{"private":' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("cache-control"), "no-store");
  assert.deepEqual(await malformed.json(), { error: "Send a valid JSON request body" });
  assert.equal(updates, 0);
  assert.deepEqual(events, []);
  const response = await fetch(url, { method: "PATCH", headers: adminHeaders, body: JSON.stringify({ phrases: { happy: [" Sxberty waves! "], abandoned: [] } }) });
  const expected = { phrases: { ...defaults().phrases, happy: ["Sxberty waves!"], abandoned: [] } };
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { settings: expected });
  assert.deepEqual(await (await fetch(`${base}/api/sxberty`)).json(), { settings: expected });
  const admin = await fetch(url, { headers: adminHeaders });
  assert.equal(admin.headers.get("cache-control"), "no-store");
  assert.deepEqual(await admin.json(), { settings: expected });
  assert.deepEqual(events, [{ actor: "test-admin", action: "sxberty.settings", resourceType: "sxberty-settings", resourceId: "global", metadata: { phases: ["happy", "abandoned"] } }]);
});

test("HTTP storage failures return generic 503 errors, appropriate caching and no update audit", async t => {
  const events = [];
  const fail = async () => { throw new Error("secret database details"); };
  const base = await serve(t, routeApp({ read: fail, update: fail, audit: async (request, event) => events.push(event) }));
  for (const [route, method, headers, body] of [
    ["/api/sxberty", "GET", {}, undefined],
    ["/api/admin/sxberty", "GET", adminHeaders, undefined],
    ["/api/admin/sxberty", "PATCH", adminHeaders, JSON.stringify({ phrases: { happy: [] } })]
  ]) {
    const response = await fetch(`${base}${route}`, { method, headers, body });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), route.includes("/admin/") ? "no-store" : "no-cache");
    assert.deepEqual(await response.json(), { error: "Sxberty settings are temporarily unavailable" });
  }
  assert.deepEqual(events, []);
});

async function preserveDatabaseRow(t) {
  if (!db.isDatabaseReady()) return;
  const previous = (await db.query("SELECT phrases, updated_at FROM sxberty_settings WHERE id = 1")).rows[0];
  t.after(async () => {
    if (previous) await db.query("INSERT INTO sxberty_settings (id, phrases, updated_at) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET phrases = EXCLUDED.phrases, updated_at = EXCLUDED.updated_at", [previous.phrases, previous.updated_at]);
    else await db.query("DELETE FROM sxberty_settings WHERE id = 1");
  });
}

test("actual server registers Sxberty before SPA fallback and uses existing admin auth and audit", async t => {
  await preserveDatabaseRow(t);
  const previous = await getSxbertySettings();
  const ledgerStart = db.isDatabaseReady() ? (await db.query("SELECT COALESCE(MAX(id), 0) AS id FROM admin_activity")).rows[0].id : null;
  if (ledgerStart !== null) t.after(() => db.query("DELETE FROM admin_activity WHERE action = 'sxberty.settings' AND id > $1", [ledgerStart]));
  const { app } = await import("./index.js");
  const base = await serve(t, app);
  const url = `${base}/api/admin/sxberty`;
  const headers = { "x-internal-api-key": process.env.INTERNAL_API_TOKEN, "content-type": "application/json" };
  for (const method of ["GET", "PATCH"]) {
    assert.equal((await fetch(url, { method })).status, 401);
    assert.equal((await fetch(url, { method, headers: { "x-internal-api-key": "wrong-key" } })).status, 401);
  }
  const publicResponse = await fetch(`${base}/api/sxberty`);
  assert.equal(publicResponse.status, 200);
  assert.match(publicResponse.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await publicResponse.json(), { settings: previous });
  const response = await fetch(url, { method: "PATCH", headers, body: JSON.stringify({ phrases: { uneasy: ["Sxberty is checking in."] } }) });
  assert.equal(response.status, 200);
  const settings = (await response.json()).settings;
  assert.deepEqual(settings, { phrases: { ...previous.phrases, uneasy: ["Sxberty is checking in."] } });
  assert.deepEqual(await getSxbertySettings(), settings);
  const events = (await listAdminActivity()).filter(event => event.action === "sxberty.settings");
  assert.ok(events.length >= 1);
  assert.deepEqual(events[0].metadata, { phases: ["uneasy"] });
});

test("optional disposable PostgreSQL singleton and concurrent updates merge distinct phases atomically", { skip: !databaseUrl }, async t => {
  await preserveDatabaseRow(t);
  await db.query("DELETE FROM sxberty_settings WHERE id = 1");
  const first = createSxbertyStore();
  const second = createSxbertyStore();
  assert.deepEqual(await first.read(), defaults());
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM sxberty_settings")).rows[0].count, 0);
  const expected = defaults();
  await Promise.all(SXBERTY_PHASES.map(({ id }, index) => {
    const phrases = index ? [`Sxberty database ${id}`] : [];
    expected.phrases[id] = phrases;
    return (index % 2 ? first : second).update({ phrases: { [id]: phrases } });
  }));
  assert.deepEqual(await first.read(), expected);
  assert.deepEqual(await second.read(), expected);
  assert.deepEqual((await db.query("SELECT phrases FROM sxberty_settings WHERE id = 1")).rows, [expected]);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM sxberty_settings")).rows[0].count, 1);
  await assert.rejects(db.query("INSERT INTO sxberty_settings (id) VALUES (2)"), error => error.code === "23514");
  await assert.rejects(db.query("UPDATE sxberty_settings SET phrases = '[]'::jsonb WHERE id = 1"), error => error.code === "23514");
});
