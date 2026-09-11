import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(moduleDir, "..");
dotenv.config({ path: path.join(projectDir, ".env") });

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL || "";
const sslEnabled = process.env.DATABASE_SSL === "true";

export const pool = connectionString
  ? new Pool({
      connectionString,
      max: Number(process.env.DATABASE_POOL_MAX || 10),
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
    })
  : null;

let databaseReady = false;
let initializationPromise = null;

export function isDatabaseConfigured() {
  return Boolean(pool);
}

export function isDatabaseReady() {
  return databaseReady;
}

export async function query(text, values) {
  if (!pool || !databaseReady) throw new Error("Database is not ready");
  return pool.query(text, values);
}

export async function withTransaction(callback) {
  if (!pool || !databaseReady) throw new Error("Database is not ready");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function initializeDatabase() {
  if (!pool) {
    console.info("PostgreSQL disabled: DATABASE_URL is not set; using local filesystem fallback.");
    return false;
  }
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fanart (
        id BIGSERIAL PRIMARY KEY,
        filename TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        hover_markdown TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL,
        image_data BYTEA NOT NULL,
        webp_data BYTEA,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE fanart ADD COLUMN IF NOT EXISTS hover_markdown TEXT NOT NULL DEFAULT '';
      ALTER TABLE fanart ADD COLUMN IF NOT EXISTS webp_data BYTEA;

      CREATE TABLE IF NOT EXISTS youtube_videos (
        video_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        thumbnail_url TEXT NOT NULL,
        video_url TEXT NOT NULL,
        published_at TIMESTAMPTZ,
        fetched_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS youtube_cache_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        fetched_at TIMESTAMPTZ,
        configured BOOLEAN NOT NULL DEFAULT FALSE,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        session_hash TEXT PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        discord_username TEXT NOT NULL,
        discord_display_name TEXT NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip_address TEXT,
        user_agent TEXT
      );

      CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions (expires_at);

      CREATE TABLE IF NOT EXISTS admin_activity (
        id BIGSERIAL PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        discord_username TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS admin_activity_created_idx ON admin_activity (created_at DESC, id DESC);
    `);
    databaseReady = true;
    return true;
  })().catch((error) => {
    databaseReady = false;
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

export async function closeDatabase() {
  if (pool) await pool.end();
  databaseReady = false;
}
