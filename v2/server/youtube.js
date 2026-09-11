import { isDatabaseReady, query, withTransaction } from "./db.js";

// Keep the backend at or above one request per minute even if an accidental
// lower value is supplied in the environment.
const configuredCacheTtlSeconds = Number(process.env.YOUTUBE_CACHE_TTL_SECONDS);
const cacheTtlMs = Math.max(
  60,
  Number.isFinite(configuredCacheTtlSeconds) ? configuredCacheTtlSeconds : 60
) * 1000;
const youtubeApiKey = process.env.YOUTUBE_API_KEY || "";
const youtubeChannelId = process.env.YOUTUBE_CHANNEL_ID || "";

let refreshPromise = null;
let scheduler = null;
let memoryCache = { configured: false, items: [], fetchedAt: null, error: null };

function isFresh(fetchedAt) {
  return Boolean(fetchedAt) && Date.now() - new Date(fetchedAt).getTime() < cacheTtlMs;
}

function formatVideo(row) {
  return {
    id: row.video_id,
    title: row.title,
    thumbnail: row.thumbnail_url,
    videoUrl: row.video_url,
    publishedAt: row.published_at || null
  };
}

async function readDatabaseCache() {
  const [stateResult, videosResult] = await Promise.all([
    query("SELECT fetched_at, configured, error FROM youtube_cache_state WHERE id = 1"),
    query("SELECT video_id, title, thumbnail_url, video_url, published_at FROM youtube_videos ORDER BY published_at DESC NULLS LAST, video_id")
  ]);
  const state = stateResult.rows[0];
  return {
    configured: Boolean(state?.configured),
    items: videosResult.rows.map(formatVideo),
    fetchedAt: state?.fetched_at || null,
    error: state?.error || null
  };
}

async function writeDatabaseCache({ configured, items, fetchedAt, error = null }) {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM youtube_videos");
    for (const item of items) {
      await client.query(
        `INSERT INTO youtube_videos (video_id, title, thumbnail_url, video_url, published_at, fetched_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [item.id, item.title, item.thumbnail, item.videoUrl, item.publishedAt || null, fetchedAt]
      );
    }
    await client.query(
      `INSERT INTO youtube_cache_state (id, fetched_at, configured, error)
       VALUES (1, $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, configured = EXCLUDED.configured, error = EXCLUDED.error`,
      [fetchedAt, configured, error]
    );
  });
}

async function requestYouTube() {
  const configured = Boolean(youtubeApiKey && youtubeChannelId);
  if (!configured) return { configured: false, items: [], error: null };

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    key: youtubeApiKey,
    channelId: youtubeChannelId,
    part: "snippet,id",
    order: "date",
    maxResults: "20"
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`YouTube responded with ${response.status}`);
  const data = await response.json();
  return {
    configured: true,
    items: (data.items || [])
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
        videoUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        publishedAt: item.snippet.publishedAt || null
      })),
    error: null
  };
}

export async function refreshYouTubeCache({ force = false } = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const cached = isDatabaseReady() ? await readDatabaseCache() : memoryCache;
    if (!force && isFresh(cached.fetchedAt)) return cached;

    const fetchedAt = new Date().toISOString();
    try {
      const fresh = await requestYouTube();
      const result = { ...fresh, fetchedAt };
      if (isDatabaseReady()) await writeDatabaseCache(result);
      memoryCache = result;
      return result;
    } catch (error) {
      const fallback = { ...cached, fetchedAt, error: error.message || "YouTube request failed" };
      if (isDatabaseReady()) {
        await query(
          `INSERT INTO youtube_cache_state (id, fetched_at, configured, error)
           VALUES (1, $1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, configured = EXCLUDED.configured, error = EXCLUDED.error`,
          [fetchedAt, fallback.configured, fallback.error]
        );
      }
      memoryCache = fallback;
      console.error("YouTube feed refresh failed:", fallback.error);
      return fallback;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function getYouTubeFeed() {
  const cached = isDatabaseReady() ? await readDatabaseCache() : memoryCache;
  return isFresh(cached.fetchedAt) ? cached : refreshYouTubeCache();
}

export function startYouTubeCacheScheduler() {
  if (scheduler) return scheduler;
  void refreshYouTubeCache();
  scheduler = setInterval(() => { void refreshYouTubeCache(); }, cacheTtlMs);
  scheduler.unref?.();
  return scheduler;
}

export function stopYouTubeCacheScheduler() {
  if (scheduler) clearInterval(scheduler);
  scheduler = null;
}
