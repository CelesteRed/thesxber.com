import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

test("approved-only hourly banners, private flags, crop cache and API", async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sxber-embed-test-"));
  const testDatabase = process.env.TEST_EMBED_DATABASE_URL || "";
  if (testDatabase && new URL(testDatabase).pathname !== "/sxber_embed_test") throw new Error("Use a disposable sxber_embed_test database");
  process.env.DATABASE_URL = testDatabase;
  process.env.DATABASE_SSL = "false";
  process.env.PUBLIC_SITE_URL = "";
  process.env.INTERNAL_API_TOKEN = "local-embed-test-only";
  process.env.FANART_DIR = path.join(scratch, "originals");
  process.env.FANART_METADATA_FILE = path.join(scratch, "metadata.json");
  process.env.FANART_WEBP_DIR = path.join(scratch, "crops");
  const db = await import("./db.js");
  const art = await import("./fanart.js");
  const embed = await import("./embed-art.js");
  let server;
  const created = [];
  try {
    await db.initializeDatabase();
    assert.equal((await art.getFanartEntries()).length, 0, "Test storage must be empty");
    assert.equal(await embed.getArtworkOfTheHour(0), null);
    const original = await sharp({ create: { width: 80, height: 160, channels: 4, background: "red" } }).png().toBuffer();
    const first = await art.saveFanartBuffer(original, { extension: ".png", title: "First" });
    created.push(first.filename);
    const second = await art.saveFanartBuffer(original, { extension: ".png", title: "Second" });
    created.push(second.filename);
    assert.equal(await embed.getArtworkOfTheHour(0), null, "New uploads are excluded");
    await assert.rejects(art.updateFanartMetadata(first.filename, { embedEligible: "false" }), /boolean/);
    await art.updateFanartMetadata(first.filename, { embedEligible: true });
    await art.updateFanartMetadata(first.filename, { title: "Updated title" });
    assert.equal((await art.getFanartEntries({ includePrivate: true }))[0].embedEligible, true);
    assert.equal("embedEligible" in (await art.getFanartEntries())[0], false);
    assert.equal((await embed.getArtworkOfTheHour(embed.HOUR_MS)).filename, first.filename);
    await art.updateFanartMetadata(second.filename, { embedEligible: true });
    const [banner, repeated] = await Promise.all([embed.getArtworkOfTheHour(0), embed.getArtworkOfTheHour(1)]);
    assert.deepEqual(banner.buffer, repeated.buffer);
    assert.equal(banner.filename, first.filename);
    assert.equal((await embed.getArtworkOfTheHour(embed.HOUR_MS - 1)).filename, first.filename);
    assert.equal((await embed.getArtworkOfTheHour(embed.HOUR_MS)).filename, second.filename);
    assert.equal((await embed.getArtworkOfTheHour(2 * embed.HOUR_MS)).filename, first.filename);
    const info = await sharp(banner.buffer).metadata();
    assert.equal(info.format, "webp");
    assert.equal(info.width, 1200);
    assert.equal(info.height, 300);
    assert.deepEqual((await art.getFanartImage(first.filename, { original: true })).buffer, original);
    if (db.isDatabaseReady()) {
      assert.ok((await db.query("SELECT embed_data FROM fanart WHERE filename=$1", [first.filename])).rows[0].embed_data.length);
    } else {
      assert.deepEqual(await fs.readFile(path.join(art.webpCacheDir, `embed-${first.filename}.webp`)), banner.buffer);
    }
    const { app } = await import("./index.js");
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/admin/fanart`)).status, 401);
    const headers = { "x-internal-api-key": process.env.INTERNAL_API_TOKEN, "content-type": "application/json" };
    const adminList = await (await fetch(`${base}/api/admin/fanart`, { headers })).json();
    assert.equal(adminList.items[0].embedEligible, true);
    const response = await fetch(`${base}/artoftheday.webp`);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.match(response.headers.get("cache-control"), /no-cache/);
    assert.equal(response.status, 200);
    assert.equal((await fetch(`${base}/api/artoftheday.webp`)).status, 200);
    const html = await (await fetch(base)).text();
    assert.match(html, /artoftheday\.webp\?v=\d+/);
    assert.ok(!html.includes("__EMBED_HOUR__"));
    const update = await fetch(`${base}/api/admin/fanart/${first.filename}`, { method: "PATCH", headers, body: JSON.stringify({ embedEligible: false }) });
    assert.equal(update.status, 200);
    assert.equal((await embed.getArtworkOfTheHour(0)).filename, second.filename, "Unchecking immediately removes a candidate");
    await art.removeFanart(second.filename);
    created.pop();
    assert.equal(await embed.getArtworkOfTheHour(0), null, "Deleted candidates are not served from cache");
    assert.equal((await fetch(`${base}/artoftheday.webp`)).status, 404);
    if (db.isDatabaseReady()) {
      const ledger = await db.query("SELECT metadata FROM admin_activity WHERE action='fanart.update'");
      assert.equal(ledger.rows[0].metadata.embedEligible, false);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const filename of created) await art.removeFanart(filename);
    await db.closeDatabase();
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
