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
  let ledgerStart = 0;
  const created = [];
  try {
    await db.initializeDatabase();
    if (db.isDatabaseReady()) ledgerStart = (await db.query("SELECT COALESCE(MAX(id), 0) AS id FROM admin_activity")).rows[0].id;
    assert.equal((await art.getFanartEntries()).length, 0, "Test storage must be empty");
    assert.equal(await embed.getArtworkOfTheHour(0), null);
    const bottom = await sharp({ create: { width: 80, height: 80, channels: 4, background: "blue" } }).png().toBuffer();
    const original = await sharp({ create: { width: 80, height: 160, channels: 4, background: "red" } })
      .composite([{ input: bottom, top: 80, left: 0 }]).png().toBuffer();
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
    const cropRoute = `${base}/api/admin/fanart/${first.filename}/embed-crop`;
    assert.equal((await fetch(cropRoute, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ crop: null }) })).status, 401);
    const sourceRoute = `${base}/api/admin/fanart/${first.filename}/crop-source`;
    assert.equal((await fetch(sourceRoute)).status, 401);
    const previewSource = await fetch(sourceRoute, { headers });
    assert.equal(previewSource.headers.get("content-type"), "image/png");
    const sourceInfo = await sharp(Buffer.from(await previewSource.arrayBuffer())).metadata();
    assert.equal(sourceInfo.width, 80);
    assert.equal(sourceInfo.height, 160);
    for (const crop of [undefined, {}, { offsetX: "0", offsetY: 0, zoom: 1 }, { offsetX: 0, offsetY: 0, zoom: 4 }]) {
      assert.equal((await fetch(cropRoute, { method: "PUT", headers, body: JSON.stringify({ crop }) })).status, 400);
    }
    const saveCrop = async (crop) => {
      const response = await fetch(cropRoute, { method: "PUT", headers, body: JSON.stringify({ crop }) });
      assert.equal(response.status, 200);
      return (await response.json()).item;
    };
    const topCrop = { offsetX: 0, offsetY: 3.5, zoom: 1 };
    assert.deepEqual((await saveCrop(topCrop)).embedCrop, topCrop);
    await art.updateFanartMetadata(first.filename, { title: "Keep my crop" });
    assert.deepEqual((await art.getFanartEntries({ includePrivate: true }))[0].embedCrop, topCrop, "Other edits preserve crop");
    assert.equal("embedCrop" in (await art.getFanartEntries())[0], false);
    const upper = await embed.getArtworkOfTheHour(0);
    let pixels = await sharp(upper.buffer).removeAlpha().raw().toBuffer();
    assert.ok(pixels[0] > 240 && pixels[2] < 15, "Top crop must show the red region");
    const lowerCrop = { offsetX: 0, offsetY: -3.5, zoom: 1 };
    await saveCrop(lowerCrop);
    const lower = await embed.getArtworkOfTheHour(0);
    assert.notDeepEqual(lower.buffer, upper.buffer, "Saved crop replaces previous cache");
    pixels = await sharp(lower.buffer).removeAlpha().raw().toBuffer();
    assert.ok(pixels[0] < 15 && pixels[2] > 240, "Bottom crop must show the blue region");
    assert.deepEqual((await art.getFanartImage(first.filename, { original: true })).buffer, original);
    assert.equal((await saveCrop(null)).embedCrop, null);
    assert.deepEqual((await embed.getArtworkOfTheHour(0)).buffer, banner.buffer, "Reset restores automatic crop");
    if (db.isDatabaseReady()) {
      const crops = await db.query("SELECT metadata FROM admin_activity WHERE action='fanart.crop' AND id > $1 ORDER BY id", [ledgerStart]);
      assert.equal(crops.rows.length, 3);
      assert.deepEqual(crops.rows[0].metadata.crop, topCrop);
      assert.equal(crops.rows[2].metadata.mode, "automatic");
    }
    const update = await fetch(`${base}/api/admin/fanart/${first.filename}`, { method: "PATCH", headers, body: JSON.stringify({ embedEligible: false }) });
    assert.equal(update.status, 200);
    assert.equal((await embed.getArtworkOfTheHour(0)).filename, second.filename, "Unchecking immediately removes a candidate");
    await art.removeFanart(second.filename);
    created.pop();
    assert.equal(await embed.getArtworkOfTheHour(0), null, "Deleted candidates are not served from cache");
    assert.equal((await fetch(`${base}/artoftheday.webp`)).status, 404);
    if (db.isDatabaseReady()) {
      const ledger = await db.query("SELECT metadata FROM admin_activity WHERE action='fanart.update' AND id > $1 ORDER BY id", [ledgerStart]);
      assert.equal(ledger.rows[0].metadata.embedEligible, false);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    for (const filename of created) await art.removeFanart(filename);
    await db.closeDatabase();
    await fs.rm(scratch, { recursive: true, force: true });
  }
});

test("crop geometry stays inside portrait and landscape sources, including EXIF rotation", async () => {
  const { bannerSourceRect, clampBannerCrop } = await import("./banner-crop.js");
  const { renderBanner } = await import("./embed-art.js");
  for (const [width, height] of [[100, 900], [900, 100], [400, 100], [1, 1]]) {
    for (const zoom of [1, 2, 3]) {
      const crop = clampBannerCrop(width, height, { offsetX: 999, offsetY: -999, zoom });
      const rect = bannerSourceRect(width, height, crop);
      assert.ok(rect.left >= 0 && rect.top >= 0);
      assert.ok(rect.left + rect.width <= width && rect.top + rect.height <= height);
    }
  }
  const source = await sharp({ create: { width: 400, height: 100, channels: 3, background: "red" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotated = await sharp(source).rotate().png().toBuffer();
  const crop = { offsetX: 0, offsetY: 1, zoom: 2 };
  assert.deepEqual(await renderBanner(source, crop), await renderBanner(rotated, crop));
});
