import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { isDatabaseConfigured, isDatabaseReady, query } from "./db.js";
import {
  SXBERTY_FOOD_MAX_BYTES, isSxbertyFoodId, toSxbertyFoodDto,
  validateSxbertyFoodCreate, validateSxbertyFoodPatch
} from "../shared/sxberty-foods.js";

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_DIMENSION = 2048;
const columns = "id, name, enabled, fullness, happiness, energy";
const defaultDatabase = { isDatabaseConfigured, isDatabaseReady, query };
// Single-process fallback: all store instances sharing a directory share a queue.
// Each food is one atomic record, including its PNG, so readers never see half an upload.
const fileQueues = new Map();

function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export async function prepareSxbertyFoodPng(input) {
  if (!Buffer.isBuffer(input) || !input.length) invalid("Upload one PNG image");
  if (input.length > SXBERTY_FOOD_MAX_BYTES) invalid("PNG must be 3 MB or smaller", 413);
  if (!input.subarray(0, 8).equals(PNG_MAGIC)) invalid("Upload a valid, static PNG image");
  // Reject APNG even when its default frame looks like a normal PNG to a decoder.
  let offset = 8;
  let ended = false;
  const decodeChunks = [PNG_MAGIC];
  while (offset < input.length) {
    if (offset + 12 > input.length) invalid("Invalid PNG image");
    const length = input.readUInt32BE(offset);
    const kind = input.toString("ascii", offset + 4, offset + 8);
    if (length > input.length - offset - 12) invalid("Invalid PNG image");
    if (offset === 8 && (kind !== "IHDR" || length !== 13)) invalid("Invalid PNG image");
    if (["acTL", "fcTL", "fdAT"].includes(kind)) invalid("Animated PNG images are not supported");
    if (kind === "IHDR" && (length !== 13 || input.readUInt32BE(offset + 8) > MAX_DIMENSION ||
        input.readUInt32BE(offset + 12) > MAX_DIMENSION)) invalid("PNG must be no larger than 2048 × 2048 pixels");
    // Never decompress arbitrary textual/profile metadata: a small zTXt/iCCP
    // chunk can expand independently of the bounded pixel dimensions.
    if (["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB"].includes(kind)) {
      decodeChunks.push(input.subarray(offset, offset + length + 12));
    }
    offset += length + 12;
    if (kind === "IEND") {
      if (length !== 0 || offset !== input.length) invalid("Invalid PNG image");
      ended = true;
      break;
    }
  }
  if (!ended) invalid("Invalid PNG image");
  try {
    const image = sharp(Buffer.concat(decodeChunks), { limitInputPixels: MAX_DIMENSION ** 2, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== "png" || !metadata.width || !metadata.height ||
        metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION ||
        (metadata.pages || 1) !== 1) invalid("PNG must be static and no larger than 2048 × 2048 pixels");
    // sharp strips metadata by default; no flatten() so alpha survives.
    const { data, info } = await image.rotate()
      .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
      .png().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (error) {
    if (error.status) throw error;
    invalid("Upload a valid, static PNG no larger than 2048 × 2048 pixels");
  }
}

export function createSxbertyFoodStore({
  storageDir = process.env.SXBERTY_FOOD_STORAGE_DIR || fileURLToPath(new URL("../data/sxberty-foods/", import.meta.url)),
  database = true,
  db = defaultDatabase
} = {}) {
  const directory = path.resolve(storageDir);
  const filename = id => path.join(directory, `${id}.json`);
  function useDatabase() {
    if (!database) return false;
    if (db.isDatabaseConfigured() && !db.isDatabaseReady()) throw new Error("Database is not ready");
    return db.isDatabaseReady();
  }
  function checkId(id) {
    if (!isSxbertyFoodId(id)) invalid("Food not found", 404);
  }
  function queued(operation) {
    const task = (fileQueues.get(directory) || Promise.resolve()).then(operation);
    const settled = task.catch(() => {});
    fileQueues.set(directory, settled);
    void settled.then(() => { if (fileQueues.get(directory) === settled) fileQueues.delete(directory); });
    return task;
  }
  async function readRecord(id) {
    try {
      const record = JSON.parse(await fs.readFile(filename(id), "utf8"));
      if (record.id !== id) throw new Error("Invalid food record");
      toSxbertyFoodDto(record);
      return record;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async function writeRecord(record) {
    await fs.mkdir(directory, { recursive: true });
    const target = filename(record.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }
  return {
    async list(admin = false) {
      if (useDatabase()) {
        const result = await db.query(`SELECT ${columns} FROM sxberty_foods ${admin ? "" : "WHERE enabled = TRUE"} ORDER BY created_at, id`);
        return result.rows.map(row => toSxbertyFoodDto(row, admin));
      }
      return queued(async () => {
        let files;
        try { files = await fs.readdir(directory); }
        catch (error) { if (error.code === "ENOENT") return []; throw error; }
        const records = [];
        for (const file of files.sort()) {
          if (!file.endsWith(".json") || !isSxbertyFoodId(file.slice(0, -5))) continue;
          const record = await readRecord(file.slice(0, -5));
          if (record && (admin || record.enabled)) records.push(record);
        }
        records.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
        return records.map(record => toSxbertyFoodDto(record, admin));
      });
    },
    async create(input, body) {
      const metadata = validateSxbertyFoodCreate(body);
      const postgres = useDatabase();
      const image = await prepareSxbertyFoodPng(input);
      const id = randomUUID();
      if (postgres) {
        const result = await db.query(`
          INSERT INTO sxberty_foods (id, name, enabled, fullness, happiness, energy, image_data, width, height)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${columns}
        `, [id, metadata.name, metadata.enabled, metadata.fullness, metadata.happiness, metadata.energy, image.data, image.width, image.height]);
        return toSxbertyFoodDto(result.rows[0], true);
      }
      return queued(async () => {
        const record = { id, ...metadata, image_data: image.data.toString("base64"), width: image.width, height: image.height, created_at: new Date().toISOString() };
        await writeRecord(record);
        return toSxbertyFoodDto(record, true);
      });
    },
    async update(id, body) {
      checkId(id);
      const changes = validateSxbertyFoodPatch(body);
      if (useDatabase()) {
        // Only validated allowlisted columns; a single UPDATE merges partial edits
        // against the current locked row without an application-side read/write race.
        const keys = Object.keys(changes);
        const result = await db.query(`UPDATE sxberty_foods SET ${keys.map((key, index) => `${key} = $${index + 2}`).join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING ${columns}`, [id, ...keys.map(key => changes[key])]);
        if (!result.rows[0]) invalid("Food not found", 404);
        return toSxbertyFoodDto(result.rows[0], true);
      }
      return queued(async () => {
        const previous = await readRecord(id);
        if (!previous) invalid("Food not found", 404);
        const record = { ...previous, ...changes, updated_at: new Date().toISOString() };
        await writeRecord(record);
        return toSxbertyFoodDto(record, true);
      });
    },
    async delete(id) {
      checkId(id);
      if (useDatabase()) {
        const result = await db.query(`DELETE FROM sxberty_foods WHERE id = $1 RETURNING ${columns}`, [id]);
        if (!result.rows[0]) invalid("Food not found", 404);
        return toSxbertyFoodDto(result.rows[0], true);
      }
      return queued(async () => {
        const record = await readRecord(id);
        if (!record) invalid("Food not found", 404);
        await fs.unlink(filename(id));
        return toSxbertyFoodDto(record, true);
      });
    },
    async image(id, admin = false) {
      checkId(id);
      if (useDatabase()) {
        const result = await db.query(`SELECT image_data FROM sxberty_foods WHERE id = $1 ${admin ? "" : "AND enabled = TRUE"}`, [id]);
        return result.rows[0] ? { data: result.rows[0].image_data, mime: "image/png" } : null;
      }
      return queued(async () => {
        const record = await readRecord(id);
        if (!record || (!admin && !record.enabled)) return null;
        return { data: Buffer.from(record.image_data, "base64"), mime: "image/png" };
      });
    }
  };
}

const store = createSxbertyFoodStore();
export const listSxbertyFoods = admin => store.list(admin);
export const createSxbertyFood = (input, body) => store.create(input, body);
export const updateSxbertyFood = (id, body) => store.update(id, body);
export const deleteSxbertyFood = id => store.delete(id);
export const sxbertyFoodImage = (id, admin) => store.image(id, admin);
