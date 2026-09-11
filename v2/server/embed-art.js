import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { isDatabaseReady, query } from "./db.js";
import { getFanartEntries, getFanartImage, webpCacheDir } from "./fanart.js";

export const EMBED_WIDTH = 1200;
export const EMBED_HEIGHT = 300;
export const HOUR_MS = 60 * 60 * 1000;
const pendingCrops = new Map();

export function selectHourlyArtwork(entries, now = Date.now()) {
  return entries.length ? entries[Math.floor(now / HOUR_MS) % entries.length] : null;
}

async function cropArtwork(filename) {
  if (isDatabaseReady()) {
    const result = await query("SELECT embed_data FROM fanart WHERE filename = $1 AND embed_eligible = TRUE", [filename]);
    if (!result.rows[0]) return null;
    if (result.rows[0].embed_data) return result.rows[0].embed_data;
  } else {
    try { return await fs.readFile(path.join(webpCacheDir, `embed-${filename}.webp`)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const image = await getFanartImage(filename, { original: true });
  if (!image) return null;
  // Use the first frame for animated uploads; preserve the untouched original.
  const buffer = await sharp(image.buffer)
    .rotate()
    .resize(EMBED_WIDTH, EMBED_HEIGHT, { fit: "cover", position: sharp.strategy.attention })
    .webp({ quality: 85 })
    .toBuffer();
  if (isDatabaseReady()) {
    const saved = await query("UPDATE fanart SET embed_data = $1 WHERE filename = $2 AND embed_eligible = TRUE", [buffer, filename]);
    if (!saved.rowCount) return null;
  } else {
    await fs.mkdir(webpCacheDir, { recursive: true });
    await fs.writeFile(path.join(webpCacheDir, `embed-${filename}.webp`), buffer);
  }
  return buffer;
}

export async function getArtworkOfTheHour(now = Date.now()) {
  const entries = isDatabaseReady()
    ? (await query("SELECT id, filename FROM fanart WHERE embed_eligible = TRUE ORDER BY id")).rows
    : (await getFanartEntries({ includePrivate: true })).filter((entry) => entry.embedEligible);
  const entry = selectHourlyArtwork(entries, now);
  if (!entry) return null;
  // Collapse simultaneous first requests for the same crop into one conversion.
  if (!pendingCrops.has(entry.filename)) {
    const pending = cropArtwork(entry.filename).finally(() => pendingCrops.delete(entry.filename));
    pendingCrops.set(entry.filename, pending);
  }
  const buffer = await pendingCrops.get(entry.filename);
  return buffer ? { buffer, filename: entry.filename } : null;
}
