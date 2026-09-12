import fs from "node:fs/promises";
import sharp from "sharp";
import { isDatabaseReady, query } from "./db.js";
import { getFanartEntries, getFanartImage, webpCacheDir, embedCachePath, persistFanartEmbedCrop } from "./fanart.js";
import { bannerSourceRect, clampBannerCrop, validateBannerCrop } from "./banner-crop.js";

export const EMBED_WIDTH = 1200;
export const EMBED_HEIGHT = 300;
export const HOUR_MS = 60 * 60 * 1000;
const pendingCrops = new Map();

export function selectHourlyArtwork(entries, now = Date.now()) {
  return entries.length ? entries[Math.floor(now / HOUR_MS) % entries.length] : null;
}

export async function renderBanner(buffer, crop = null) {
  // Normalize EXIF orientation before applying the same geometry as the browser.
  const oriented = await sharp(buffer).rotate().raw().toBuffer({ resolveWithObject: true });
  const image = sharp(oriented.data, { raw: {
    width: oriented.info.width, height: oriented.info.height, channels: oriented.info.channels
  } });
  if (crop) image.extract(bannerSourceRect(oriented.info.width, oriented.info.height, crop));
  return image.resize(EMBED_WIDTH, EMBED_HEIGHT, {
    fit: crop ? "fill" : "cover", position: sharp.strategy.attention
  }).webp({ quality: 85 }).toBuffer();
}

export async function prepareBannerCrop(filename, value) {
  let crop = validateBannerCrop(value);
  const image = await getFanartImage(filename, { original: true });
  if (!image) throw new Error("Fanart not found");
  if (crop) {
    const metadata = await sharp(image.buffer).metadata();
    const rotated = [5, 6, 7, 8].includes(metadata.orientation);
    crop = clampBannerCrop(rotated ? metadata.height : metadata.width, rotated ? metadata.width : metadata.height, crop);
  }
  return { crop, buffer: await renderBanner(image.buffer, crop) };
}

export async function saveBannerCrop(filename, value) {
  const { crop, buffer } = await prepareBannerCrop(filename, value);
  return persistFanartEmbedCrop(filename, crop, buffer);
}

async function cropArtwork(filename, crop) {
  if (isDatabaseReady()) {
    const result = await query("SELECT embed_data FROM fanart WHERE filename = $1 AND embed_eligible = TRUE AND embed_crop IS NOT DISTINCT FROM $2::jsonb", [filename, crop]);
    if (!result.rows[0]) return null;
    if (result.rows[0].embed_data) return result.rows[0].embed_data;
  } else {
    try { return await fs.readFile(embedCachePath(filename, crop)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const image = await getFanartImage(filename, { original: true });
  if (!image) return null;
  // Use the first frame for animated uploads; preserve the untouched original.
  const buffer = await renderBanner(image.buffer, crop);
  if (isDatabaseReady()) {
    const saved = await query("UPDATE fanart SET embed_data = $1 WHERE filename = $2 AND embed_eligible = TRUE AND embed_crop IS NOT DISTINCT FROM $3::jsonb", [buffer, filename, crop]);
    if (!saved.rowCount) return null;
  } else {
    await fs.mkdir(webpCacheDir, { recursive: true });
    await fs.writeFile(embedCachePath(filename, crop), buffer);
  }
  return buffer;
}

export async function getArtworkOfTheHour(now = Date.now()) {
  const entries = isDatabaseReady()
    ? (await query("SELECT id, filename, embed_crop FROM fanart WHERE embed_eligible = TRUE ORDER BY id")).rows
    : (await getFanartEntries({ includePrivate: true })).filter((entry) => entry.embedEligible);
  const entry = selectHourlyArtwork(entries, now);
  if (!entry) return null;
  const crop = entry.embed_crop || entry.embedCrop || null;
  const key = `${entry.filename}:${JSON.stringify(crop)}`;
  // Collapse simultaneous first requests for the same crop into one conversion.
  if (!pendingCrops.has(key)) {
    const pending = cropArtwork(entry.filename, crop).finally(() => pendingCrops.delete(key));
    pendingCrops.set(key, pending);
  }
  const buffer = await pendingCrops.get(key);
  return buffer ? { buffer, filename: entry.filename } : null;
}
