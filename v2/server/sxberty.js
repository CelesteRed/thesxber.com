import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDatabaseConfigured, isDatabaseReady, query } from "./db.js";
import { DEFAULT_SXBERTY_SETTINGS, normalizeSxbertySettings, validateSxbertyPatch } from "../shared/sxberty.js";

// Shared by stores for the same file, so requests cannot overwrite another phase.
// Filesystem fallback is single-process; PostgreSQL also coordinates replicas.
const fileQueues = new Map();
const defaultDatabase = { isDatabaseConfigured, isDatabaseReady, query };

export function createSxbertyStore({
  storageDir = process.env.SXBERTY_STORAGE_DIR || fileURLToPath(new URL("../data/sxberty/", import.meta.url)),
  database = true,
  db = defaultDatabase
} = {}) {
  const filename = path.resolve(storageDir, "settings.json");

  function useDatabase() {
    if (!database) return false;
    if (db.isDatabaseConfigured() && !db.isDatabaseReady()) throw new Error("Database is not ready");
    return db.isDatabaseReady();
  }

  async function readFile() {
    try {
      return normalizeSxbertySettings(JSON.parse(await fs.readFile(filename, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return normalizeSxbertySettings();
      throw error;
    }
  }

  function mutateFile(changes) {
    const task = (fileQueues.get(filename) || Promise.resolve()).then(async () => {
      const previous = await readFile();
      const settings = { phrases: { ...previous.phrases, ...changes.phrases } };
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await fs.rename(temporary, filename);
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
      return settings;
    });
    const settled = task.catch(() => {});
    fileQueues.set(filename, settled);
    void settled.then(() => {
      if (fileQueues.get(filename) === settled) fileQueues.delete(filename);
    });
    return task;
  }

  return {
    async read() {
      if (useDatabase()) {
        const result = await db.query("SELECT phrases FROM sxberty_settings WHERE id = 1");
        return normalizeSxbertySettings(result.rows[0]);
      }
      await fileQueues.get(filename);
      return readFile();
    },
    async update(body) {
      const changes = validateSxbertyPatch(body);
      if (!useDatabase()) return mutateFile(changes);
      // ON CONFLICT locks the singleton and merges against its latest value,
      // rather than a stale application-side read. Different phases survive.
      const result = await db.query(`
        INSERT INTO sxberty_settings (id, phrases) VALUES (1, $1::jsonb || $2::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          phrases = sxberty_settings.phrases || $2::jsonb,
          updated_at = NOW()
        RETURNING phrases
      `, [JSON.stringify(DEFAULT_SXBERTY_SETTINGS.phrases), JSON.stringify(changes.phrases)]);
      return normalizeSxbertySettings(result.rows[0]);
    }
  };
}

const store = createSxbertyStore();
export const getSxbertySettings = () => store.read();
export const updateSxbertySettings = body => store.update(body);
