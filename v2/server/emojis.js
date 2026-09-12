import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { isDatabaseReady, query } from "./db.js";
import { normalizeCreditUrl } from "./fanart-fields.js";

const storage = process.env.EMOJI_STORAGE_DIR || fileURLToPath(new URL("../data/emojis/", import.meta.url));
const metadataFile = path.join(storage, "metadata.json");
const settingsFile = path.join(storage, "settings.json");
const columns = "id, name, enabled, quotes, held_quotes, fanart_quotes, links";
const validId = (id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
const format = (row) => ({ id: row.id, name: row.name, enabled: row.enabled, quotes: row.quotes,
  heldQuotes: row.held_quotes, fanartQuotes: row.fanart_quotes, links: row.links, url: `/emojis/${row.id}.webp` });
async function readLocal() {
  try { return JSON.parse(await fs.readFile(metadataFile, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}
async function writeLocal(value) {
  await fs.mkdir(storage, { recursive: true });
  const temporary = `${metadataFile}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value));
  await fs.rename(temporary, metadataFile);
}
// Serialize filesystem updates so uploads and edits cannot lose another row.
let queue = Promise.resolve();
const localChange = (fn) => {
  const pending = queue.then(fn);
  queue = pending.catch(() => {});
  return pending;
};

export async function getEmojiSettings() {
  if (isDatabaseReady()) {
    const result = await query("SELECT emoji_count FROM floating_emoji_settings WHERE id=1");
    return { count: result.rows[0]?.emoji_count ?? 10 };
  }
  try { return JSON.parse(await fs.readFile(settingsFile, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return { count: 10 }; throw error; }
}

export async function updateEmojiSettings(input) {
  const count = input?.count;
  if (!Number.isInteger(count) || count < 0 || count > 30) throw new Error("Emoji count must be a whole number from 0 to 30");
  if (isDatabaseReady()) {
    await query("INSERT INTO floating_emoji_settings (id,emoji_count) VALUES (1,$1) ON CONFLICT (id) DO UPDATE SET emoji_count=EXCLUDED.emoji_count", [count]);
  } else {
    await localChange(async () => {
      await fs.mkdir(storage, { recursive: true });
      const temporary = `${settingsFile}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ count }));
      await fs.rename(temporary, settingsFile);
    });
  }
  return { count };
}

export function emojiFields(input = {}, defaults = false) {
  const fields = {};
  if (defaults || input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 60) throw new Error("Give the emoji a name of 1–60 characters");
    fields.name = input.name.trim();
  }
  if (defaults || input.enabled !== undefined) {
    if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("Enabled must be a boolean");
    fields.enabled = input.enabled ?? true;
  }
  for (const [key, column] of Object.entries({ quotes: "quotes", heldQuotes: "held_quotes", fanartQuotes: "fanart_quotes", links: "links" })) {
    if (!defaults && input[key] === undefined) continue;
    const values = input[key] ?? [];
    if (!Array.isArray(values) || values.length > 30 || values.some(value => typeof value !== "string" || value.length > (key === "links" ? 2048 : 100))) {
      throw new Error(key === "links" ? "Use up to 30 valid links" : "Use up to 30 quotes, each 100 characters or fewer");
    }
    fields[column] = values.map(value => key === "links" ? normalizeCreditUrl(value) : value.trim()).filter(Boolean);
  }
  if (!Object.keys(fields).length) throw new Error("No emoji changes provided");
  return fields;
}

export async function listEmojis(admin = false) {
  const rows = isDatabaseReady()
    ? (await query(`SELECT ${columns} FROM floating_emojis ${admin ? "" : "WHERE enabled=TRUE"} ORDER BY created_at, id`)).rows
    : Object.values(await readLocal()).filter(row => admin || row.enabled);
  return rows.map(format);
}

export async function createEmoji(buffer, input) {
  const fields = emojiFields(input, true);
  if (!buffer?.length || buffer.length > 3 * 1024 * 1024) throw new Error("Emoji uploads must be 3 MB or smaller");
  const info = await sharp(buffer, { animated: true, limitInputPixels: 32 * 1024 * 1024 }).metadata();
  if (!["png", "jpeg", "webp", "gif"].includes(info.format) || (info.pages || 1) > 100 || info.width > 4096 || (info.pageHeight || info.height) > 4096) {
    throw new Error("Use a PNG, JPG, WebP or GIF up to 4096px per side and 100 frames");
  }
  const webp = await sharp(buffer, { animated: true, limitInputPixels: 32 * 1024 * 1024 })
    .rotate().resize({ width: 256, height: 256, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  const id = randomUUID();
  const mime = `image/${info.format === "jpg" ? "jpeg" : info.format}`;
  if (isDatabaseReady()) {
    const row = await query(`INSERT INTO floating_emojis (id,name,enabled,quotes,held_quotes,fanart_quotes,links,original_data,original_mime,webp_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${columns}`,
    [id, fields.name, fields.enabled, JSON.stringify(fields.quotes), JSON.stringify(fields.held_quotes), JSON.stringify(fields.fanart_quotes), JSON.stringify(fields.links), buffer, mime, webp]);
    return format(row.rows[0]);
  }
  return localChange(async () => {
    const data = await readLocal();
    await fs.mkdir(storage, { recursive: true });
    await fs.writeFile(path.join(storage, `${id}.original`), buffer);
    await fs.writeFile(path.join(storage, `${id}.webp`), webp);
    data[id] = { id, ...fields, original_mime: mime };
    await writeLocal(data);
    return format(data[id]);
  });
}

export async function updateEmoji(id, input) {
  if (!validId(id)) throw new Error("Invalid emoji ID");
  const fields = emojiFields(input);
  if (isDatabaseReady()) {
    const values = Object.values(fields).map(value => Array.isArray(value) ? JSON.stringify(value) : value);
    const assignments = Object.keys(fields).map((key, index) => `${key}=$${index + 1}`);
    const result = await query(`UPDATE floating_emojis SET ${assignments.join(",")} WHERE id=$${values.length + 1} RETURNING ${columns}`, [...values, id]);
    if (!result.rows[0]) throw new Error("Emoji not found");
    return format(result.rows[0]);
  }
  return localChange(async () => {
    const data = await readLocal();
    if (!data[id]) throw new Error("Emoji not found");
    data[id] = { ...data[id], ...fields };
    await writeLocal(data);
    return format(data[id]);
  });
}

export async function emojiImage(id, original = false) {
  if (!validId(id)) return null;
  if (isDatabaseReady()) {
    const result = await query(`SELECT ${original ? "original_data AS data, original_mime AS mime" : "webp_data AS data, 'image/webp' AS mime"} FROM floating_emojis WHERE id=$1 ${original ? "" : "AND enabled=TRUE"}`, [id]);
    return result.rows[0] || null;
  }
  const entry = (await readLocal())[id];
  if (!entry || (!original && !entry.enabled)) return null;
  return { data: await fs.readFile(path.join(storage, `${id}.${original ? "original" : "webp"}`)), mime: original ? entry.original_mime : "image/webp" };
}

export async function deleteEmoji(id) {
  if (!validId(id)) throw new Error("Invalid emoji ID");
  if (isDatabaseReady()) {
    if (!(await query("DELETE FROM floating_emojis WHERE id=$1", [id])).rowCount) throw new Error("Emoji not found");
    return;
  }
  return localChange(async () => {
    const data = await readLocal();
    if (!data[id]) throw new Error("Emoji not found");
    delete data[id];
    await writeLocal(data);
    await Promise.all([fs.rm(path.join(storage, `${id}.original`), { force: true }), fs.rm(path.join(storage, `${id}.webp`), { force: true })]);
  });
}
