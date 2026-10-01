import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDatabaseConfigured, isDatabaseReady, query, withTransaction } from "./db.js";

const emptyState = () => ({ fetchedAt: null, lastAttemptAt: null, lastManualAt: null, syncToken: null, syncExpiresAt: null, uploadsPlaylistId: null, error: null });
const iso = value => value ? new Date(value).toISOString() : null;
function stateFromRow(row = {}) {
  return { fetchedAt: iso(row.fetched_at), lastAttemptAt: iso(row.last_attempt_at), lastManualAt: iso(row.last_manual_at),
    syncToken: row.sync_token || null, syncExpiresAt: iso(row.sync_expires_at), uploadsPlaylistId: row.uploads_playlist_id || null, error: row.error || null };
}
function videoFromRow(row) {
  return { id: row.video_id, title: row.title, thumbnail: row.thumbnail_url, videoUrl: row.video_url,
    publishedAt: iso(row.published_at), hidden: row.hidden, hoverText: row.hover_text, format: row.format || "unknown", formatOverride: row.format_override, inFeed: row.in_feed,
    viewCount: row.view_count ?? null, duration: row.duration || null, description: row.description || "" };
}
async function lockState(client) {
  await client.query("INSERT INTO youtube_cache_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
  return stateFromRow((await client.query("SELECT * FROM youtube_cache_state WHERE id = 1 FOR UPDATE")).rows[0]);
}
async function writeState(client, state) {
  await client.query(`UPDATE youtube_cache_state SET fetched_at=$1, last_attempt_at=$2, last_manual_at=$3,
    sync_token=$4, sync_expires_at=$5, uploads_playlist_id=$6, error=$7, configured=TRUE WHERE id=1`,
  [state.fetchedAt, state.lastAttemptAt, state.lastManualAt, state.syncToken, state.syncExpiresAt, state.uploadsPlaylistId, state.error]);
}

export function createYouTubeStore({ filename = process.env.YOUTUBE_CACHE_FILE || fileURLToPath(new URL("../data/youtube.json", import.meta.url)), database = true } = {}) {
  let queue = Promise.resolve();
  function useDatabase() {
    if (database && isDatabaseConfigured() && !isDatabaseReady()) throw new Error("Database is not ready");
    return database && isDatabaseReady();
  }
  async function readFile() {
    try { return JSON.parse(await fs.readFile(filename, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return { state: emptyState(), items: [] }; throw error; }
  }
  // Filesystem fallback supports one process; PostgreSQL serializes across replicas.
  function mutateFile(callback) {
    const task = queue.then(async () => {
      const data = await readFile();
      const result = await callback(data);
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await fs.rename(temporary, filename);
      return result;
    });
    queue = task.catch(() => {});
    return task;
  }
  return {
    async read() {
      if (!useDatabase()) { await queue; return readFile(); }
      return withTransaction(async client => {
        const state = await lockState(client);
        const rows = await client.query("SELECT * FROM youtube_videos ORDER BY published_at DESC NULLS LAST, video_id");
        return { state, items: rows.rows.map(videoFromRow) };
      });
    },
    async mutateState(callback) {
      if (!useDatabase()) return mutateFile(data => callback(data.state));
      return withTransaction(async client => {
        const state = await lockState(client);
        const result = callback(state);
        await writeState(client, state);
        return result;
      });
    },
    async complete(token, { items, fetchedAt, uploadsPlaylistId, error = null }) {
      if (!useDatabase()) return mutateFile(data => {
        if (data.state.syncToken !== token) throw new Error("Video sync lease expired");
        if (items) {
          const previous = new Map(data.items.map(item => [item.id, item]));
          const current = new Map(data.items.map(item => [item.id, { ...item, inFeed: false }]));
          for (const item of items) {
            const old = previous.get(item.id);
            const formatOverride = old?.formatOverride ?? old?.format === "short";
            current.set(item.id, { ...item, hidden: old?.hidden ?? false, hoverText: old?.hoverText ?? "",
              formatOverride, format: formatOverride ? old.format : item.format === "unknown" ? old?.format || "unknown" : item.format, inFeed: true });
          }
          data.items = [...current.values()];
          data.state.fetchedAt = fetchedAt;
          data.state.uploadsPlaylistId = uploadsPlaylistId;
        }
        Object.assign(data.state, { error, syncToken: null, syncExpiresAt: null });
      });
      return withTransaction(async client => {
        const state = await lockState(client);
        if (state.syncToken !== token) throw new Error("Video sync lease expired");
        if (items) {
          await client.query("UPDATE youtube_videos SET in_feed=FALSE WHERE in_feed=TRUE");
          for (const item of items) await client.query(`INSERT INTO youtube_videos
            (video_id,title,thumbnail_url,video_url,published_at,fetched_at,view_count,duration,description,format,in_feed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)
            ON CONFLICT (video_id) DO UPDATE SET title=EXCLUDED.title,thumbnail_url=EXCLUDED.thumbnail_url,
            video_url=EXCLUDED.video_url,published_at=EXCLUDED.published_at,fetched_at=EXCLUDED.fetched_at,
            view_count=EXCLUDED.view_count,duration=EXCLUDED.duration,description=EXCLUDED.description,
            format=CASE WHEN youtube_videos.format_override OR EXCLUDED.format='unknown' THEN youtube_videos.format ELSE EXCLUDED.format END,in_feed=TRUE`,
          [item.id, item.title, item.thumbnail, item.videoUrl, item.publishedAt, fetchedAt, item.viewCount ?? null, item.duration || null, item.description || "", item.format || "unknown"]);
          state.fetchedAt = fetchedAt;
          state.uploadsPlaylistId = uploadsPlaylistId;
        }
        Object.assign(state, { error, syncToken: null, syncExpiresAt: null });
        await writeState(client, state);
      });
    },
    async update(id, changes) {
      if (!useDatabase()) return mutateFile(data => {
        const item = data.items.find(item => item.id === id && item.inFeed);
        if (!item) return null;
        Object.assign(item, changes);
        return { ...item };
      });
      const result = await query(`UPDATE youtube_videos SET hidden=COALESCE($2,hidden), hover_text=COALESCE($3,hover_text), format=COALESCE($4,format), format_override=COALESCE($5,format_override)
        WHERE video_id=$1 AND in_feed=TRUE RETURNING *`, [id, changes.hidden ?? null, changes.hoverText ?? null, changes.format ?? null, changes.formatOverride ?? null]);
      return result.rows[0] ? videoFromRow(result.rows[0]) : null;
    }
  };
}
