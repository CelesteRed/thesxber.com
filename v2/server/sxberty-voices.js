import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDatabaseConfigured, isDatabaseReady, query } from "./db.js";
import {
  SXBERTY_VOICE_MAX_BYTES, SXBERTY_VOICE_MAX_DURATION_MS, isSxbertyVoiceId,
  toSxbertyVoiceDto, validateSxbertyVoiceCreate, validateSxbertyVoicePatch
} from "../shared/sxberty-voices.js";

const columns = "id, name, enabled, trigger, caption, duration_ms";
const defaultDatabase = { isDatabaseConfigured, isDatabaseReady, query };
const fileQueues = new Map();
const MAX_ID3_BYTES = 512 * 1024;
const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
function invalid(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function badMp3() { invalid("Upload a complete, valid MPEG Layer III MP3"); }

// Bounded structural validation, not a decoder: accepts standard CBR/VBR MPEG
// Layer III frames, with one consistent version/sample rate/channel count.
// Free-format bitrates are intentionally unsupported. No extension/MIME trust.
export function prepareSxbertyVoiceMp3(input) {
  if (!Buffer.isBuffer(input) || !input.length) invalid("Upload one MP3 voice line");
  if (input.length > SXBERTY_VOICE_MAX_BYTES) invalid("MP3 must be 5 MB or smaller", 413);
  let start = 0;
  let end = input.length;
  if (input.subarray(0, 3).equals(Buffer.from("ID3"))) {
    if (input.length < 10) badMp3();
    const version = input[3];
    const flags = input[5];
    if (![2, 3, 4].includes(version) || input[4] === 255 || (flags & (version === 2 ? 0x3f : version === 3 ? 0x1f : 0x0f))) badMp3();
    // ID3v2.2 compressed tags are not supported; v2.4 footers are checked below.
    if (version === 2 && (flags & 0x40)) badMp3();
    const sizeBytes = input.subarray(6, 10);
    if (sizeBytes.some(byte => byte & 0x80)) badMp3();
    const size = sizeBytes.reduce((value, byte) => value * 128 + byte, 0);
    const footerSize = version === 4 && (flags & 0x10) ? 10 : 0;
    start = 10 + size + footerSize;
    if (start > end || start > MAX_ID3_BYTES) badMp3();
    if (footerSize) {
      const footer = input.subarray(start - 10, start);
      if (!footer.subarray(0, 3).equals(Buffer.from("3DI")) || !footer.subarray(3).equals(input.subarray(3, 10))) badMp3();
    }
    // The declared tag includes its padding. Do not scan arbitrary bytes for
    // sync words: every byte outside this bounded tag must be a full frame.
  }
  if (end - start >= 128 && input.subarray(end - 128, end - 125).equals(Buffer.from("TAG"))) end -= 128;
  let offset = start;
  let frameCount = 0;
  let totalSamples = 0;
  let sampleRate;
  let streamKey;
  while (offset < end) {
    if (end - offset < 4) badMp3();
    const a = input[offset], b = input[offset + 1], c = input[offset + 2], d = input[offset + 3];
    if (a !== 255 || (b & 0xe0) !== 0xe0) badMp3();
    const version = (b >> 3) & 3;
    const layer = (b >> 1) & 3;
    const bitrateIndex = c >> 4;
    const sampleIndex = (c >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIndex === 0 || bitrateIndex === 15 || sampleIndex === 3 || (d & 3) === 2) badMp3();
    const rate = [44100, 48000, 32000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
    const channels = (d >> 6) === 3 ? 1 : 2;
    const key = `${version}:${rate}:${channels}`;
    if (streamKey && streamKey !== key) badMp3();
    streamKey = key;
    sampleRate = rate;
    const bitrate = (version === 3 ? MPEG1_BITRATES : MPEG2_BITRATES)[bitrateIndex];
    const length = Math.floor((version === 3 ? 144000 : 72000) * bitrate / rate) + ((c >> 1) & 1);
    const sideInfoSize = version === 3 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
    const headerSize = 4 + ((b & 1) ? 0 : 2);
    if (length <= headerSize + sideInfoSize || length > end - offset) badMp3();
    offset += length;
    frameCount += 1;
    totalSamples += version === 3 ? 1152 : 576;
    if (totalSamples * 1000 > sampleRate * SXBERTY_VOICE_MAX_DURATION_MS) invalid("Voice line must be 30 seconds or shorter");
  }
  // More than one consecutive complete frame prevents accepting tiny files
  // consisting of only a plausible sync/header. Duration is frame-derived.
  if (frameCount < 2 || offset !== end) badMp3();
  return { data: Buffer.from(input.subarray(start, end)), durationMs: Math.ceil(totalSamples * 1000 / sampleRate) };
}

export function createSxbertyVoiceStore({
  storageDir = process.env.SXBERTY_VOICE_STORAGE_DIR || fileURLToPath(new URL("../data/sxberty-voices/", import.meta.url)),
  database = true, db = defaultDatabase
} = {}) {
  const directory = path.resolve(storageDir);
  const filename = id => path.join(directory, `${id}.json`);
  function useDatabase() {
    if (!database) return false;
    if (db.isDatabaseConfigured() && !db.isDatabaseReady()) throw new Error("Database is not ready");
    return db.isDatabaseReady();
  }
  function checkId(id) { if (!isSxbertyVoiceId(id)) invalid("Voice not found", 404); }
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
      if (record.id !== id) throw new Error("Invalid voice record");
      toSxbertyVoiceDto(record);
      if (typeof record.audio_data !== "string" || !record.audio_data.length || record.audio_data.length > Math.ceil(SXBERTY_VOICE_MAX_BYTES / 3) * 4) throw new Error("Invalid voice audio record");
      const data = Buffer.from(record.audio_data, "base64");
      if (data.length > SXBERTY_VOICE_MAX_BYTES || data.toString("base64") !== record.audio_data) throw new Error("Invalid voice audio record");
      return record;
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async function writeRecord(record) {
    await fs.mkdir(directory, { recursive: true });
    const target = filename(record.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  return {
    async list(admin = false) {
      if (useDatabase()) {
        const result = await db.query(`SELECT ${columns} FROM sxberty_voices ${admin ? "" : "WHERE enabled = TRUE"} ORDER BY created_at, id`);
        return result.rows.map(row => toSxbertyVoiceDto(row, admin));
      }
      return queued(async () => {
        let files;
        try { files = await fs.readdir(directory); }
        catch (error) { if (error.code === "ENOENT") return []; throw error; }
        const records = [];
        for (const file of files.sort()) {
          if (!file.endsWith(".json") || !isSxbertyVoiceId(file.slice(0, -5))) continue;
          const record = await readRecord(file.slice(0, -5));
          if (record && (admin || record.enabled)) records.push(record);
        }
        records.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
        return records.map(record => toSxbertyVoiceDto(record, admin));
      });
    },
    async create(input, body) {
      const metadata = validateSxbertyVoiceCreate(body);
      const postgres = useDatabase();
      const audio = prepareSxbertyVoiceMp3(input);
      const id = randomUUID();
      if (postgres) {
        const result = await db.query(`INSERT INTO sxberty_voices (id, name, enabled, trigger, caption, duration_ms, audio_data)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${columns}`,
        [id, metadata.name, metadata.enabled, metadata.trigger, metadata.caption, audio.durationMs, audio.data]);
        return toSxbertyVoiceDto(result.rows[0], true);
      }
      return queued(async () => {
        const record = { id, ...metadata, duration_ms: audio.durationMs, audio_data: audio.data.toString("base64"), created_at: new Date().toISOString() };
        await writeRecord(record);
        return toSxbertyVoiceDto(record, true);
      });
    },
    async update(id, body) {
      checkId(id);
      const changes = validateSxbertyVoicePatch(body);
      if (useDatabase()) {
        const keys = Object.keys(changes);
        const result = await db.query(`UPDATE sxberty_voices SET ${keys.map((key, index) => `${key} = $${index + 2}`).join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING ${columns}`, [id, ...keys.map(key => changes[key])]);
        if (!result.rows[0]) invalid("Voice not found", 404);
        return toSxbertyVoiceDto(result.rows[0], true);
      }
      return queued(async () => {
        const previous = await readRecord(id);
        if (!previous) invalid("Voice not found", 404);
        const record = { ...previous, ...changes, updated_at: new Date().toISOString() };
        await writeRecord(record);
        return toSxbertyVoiceDto(record, true);
      });
    },
    async delete(id) {
      checkId(id);
      if (useDatabase()) {
        const result = await db.query(`DELETE FROM sxberty_voices WHERE id = $1 RETURNING ${columns}`, [id]);
        if (!result.rows[0]) invalid("Voice not found", 404);
        return toSxbertyVoiceDto(result.rows[0], true);
      }
      return queued(async () => {
        const record = await readRecord(id);
        if (!record) invalid("Voice not found", 404);
        await fs.unlink(filename(id));
        return toSxbertyVoiceDto(record, true);
      });
    },
    async audio(id, admin = false) {
      checkId(id);
      if (useDatabase()) {
        const result = await db.query(`SELECT audio_data FROM sxberty_voices WHERE id = $1 ${admin ? "" : "AND enabled = TRUE"}`, [id]);
        return result.rows[0] ? { data: result.rows[0].audio_data, mime: "audio/mpeg" } : null;
      }
      return queued(async () => {
        const record = await readRecord(id);
        if (!record || (!admin && !record.enabled)) return null;
        return { data: Buffer.from(record.audio_data, "base64"), mime: "audio/mpeg" };
      });
    }
  };
}
const store = createSxbertyVoiceStore();
export const listSxbertyVoices = admin => store.list(admin);
export const createSxbertyVoice = (input, body) => store.create(input, body);
export const updateSxbertyVoice = (id, body) => store.update(id, body);
export const deleteSxbertyVoice = id => store.delete(id);
export const sxbertyVoiceAudio = (id, admin) => store.audio(id, admin);
