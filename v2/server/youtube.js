import crypto from "node:crypto";
import { createYouTubeStore } from "./youtube-store.js";
import { detectYouTubeFormat, identifyVideoFormats } from "./youtube-format.js";

export const YOUTUBE_HOUR_MS = 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
function httpError(message, status, nextSyncAt) { return Object.assign(new Error(message), { status, nextSyncAt }); }
function publicItem({ id, title, thumbnail, videoUrl, publishedAt, hoverText, format, viewCount, duration, description }) {
  const resolved = ["short", "video"].includes(format) ? format : "unknown";
  return { id, title, thumbnail, videoUrl: resolved === "short" ? `https://www.youtube.com/shorts/${id}` : videoUrl, publishedAt, hoverText: hoverText || "", format: resolved,
    viewCount: /^\d+$/.test(String(viewCount)) ? String(viewCount) : null, duration: duration || null, description: description || "" };
}

export function createYouTubeService({ store = createYouTubeStore(), fetcher = fetch, now = Date.now, detectFormat = detectYouTubeFormat,
  key = process.env.YOUTUBE_API_KEY || "", channelId = process.env.YOUTUBE_CHANNEL_ID || "",
  intervalMs = Math.max(3600, Number(process.env.YOUTUBE_CACHE_TTL_SECONDS) || 3600) * 1000 } = {}) {
  intervalMs = Number.isFinite(intervalMs) ? Math.max(YOUTUBE_HOUR_MS, intervalMs) : YOUTUBE_HOUR_MS;
  const configured = Boolean(key && channelId);
  let scheduler;
  async function request(resource, params, signal) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.search = new URLSearchParams({ key, ...params });
    let response;
    try { response = await fetcher(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) }); }
    catch { throw new Error("YouTube request timed out or could not connect"); }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const quota = response.status === 429 || data.error?.errors?.some(item => /quota|rateLimit|dailyLimit/i.test(item.reason));
      throw new Error(quota ? "YouTube quota exceeded. Cached videos are still available; retry after the cooldown." : `YouTube request failed (HTTP ${response.status})`);
    }
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error("YouTube returned an invalid video response");
    return data;
  }
  async function download(playlistId) {
    const signal = AbortSignal.timeout(90000);
    if (!playlistId) {
      const channel = await request("channels", { part: "contentDetails", id: channelId }, signal);
      playlistId = channel.items[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!playlistId) throw new Error("No uploads playlist was found for the configured channel");
    }
    const items = new Map();
    const tokens = new Set();
    let pageToken;
    for (let page = 0; page < 100; page++) {
      const data = await request("playlistItems", { part: "snippet,contentDetails,status", playlistId, maxResults: "50", ...(pageToken ? { pageToken } : {}) }, signal);
      const pageItems = new Map();
      for (const item of data.items) {
        const id = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
        const snippet = item.snippet;
        if (item.status?.privacyStatus !== "public" || !/^[\w-]{11}$/.test(id || "") || !snippet?.title) continue;
        const thumbnail = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url;
        if (!thumbnail?.startsWith("https://")) continue;
        pageItems.set(id, { id, title: snippet.title, thumbnail, videoUrl: `https://www.youtube.com/watch?v=${id}`,
          publishedAt: item.contentDetails?.videoPublishedAt || snippet.publishedAt || null });
      }
      // Fetch statistics in batches during the existing sync, never on page views.
      if (pageItems.size) {
        const details = await request("videos", { part: "snippet,statistics,contentDetails,status", id: [...pageItems.keys()].join(",") }, signal);
        for (const video of details.items) {
          const item = pageItems.get(video.id);
          if (!item || video.status?.privacyStatus !== "public") continue;
          items.set(video.id, { ...item,
            viewCount: /^\d+$/.test(String(video.statistics?.viewCount)) ? String(video.statistics.viewCount) : null,
            duration: video.contentDetails?.duration || null,
            description: (video.snippet?.description || "").slice(0, 500)
          });
        }
      }
      pageToken = data.nextPageToken;
      if (!pageToken) return { items: await identifyVideoFormats([...items.values()], detectFormat), uploadsPlaylistId: playlistId };
      if (tokens.has(pageToken)) throw new Error("YouTube returned a repeated page; cached videos were preserved");
      tokens.add(pageToken);
    }
    throw new Error("Video sync exceeded 5,000 playlist entries; cached videos were preserved");
  }
  async function adminFeed() {
    const { state, items } = await store.read();
    const nextSyncAt = state.lastManualAt ? new Date(Date.parse(state.lastManualAt) + YOUTUBE_HOUR_MS).toISOString() : null;
    return { configured, items: items.filter(item => item.inFeed).sort((a,b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).map(item => ({ ...publicItem(item), hidden: item.hidden, formatOverride: item.formatOverride ?? item.format === "short" })),
      fetchedAt: state.fetchedAt, lastAttemptAt: state.lastAttemptAt, error: state.error,
      sync: { nextSyncAt, serverTime: new Date(now()).toISOString(), inProgress: Boolean(state.syncToken && Date.parse(state.syncExpiresAt) > now()),
        nextAutomaticAt: state.lastAttemptAt ? new Date(Date.parse(state.lastAttemptAt) + intervalMs).toISOString() : null } };
  }
  async function sync({ manual = false } = {}) {
    if (!configured) { if (manual) throw httpError("YouTube is not configured", 503); return; }
    const token = crypto.randomUUID();
    const claim = await store.mutateState(state => {
      const time = now();
      if (state.syncToken && Date.parse(state.syncExpiresAt) > time) {
        if (manual) throw httpError("A video sync is already running", 409);
        return null;
      }
      if (manual && state.lastManualAt && time < Date.parse(state.lastManualAt) + YOUTUBE_HOUR_MS) {
        throw httpError("Sync videos now can be used once per hour across all admins", 429, new Date(Date.parse(state.lastManualAt) + YOUTUBE_HOUR_MS).toISOString());
      }
      if (!manual && state.lastAttemptAt && time < Date.parse(state.lastAttemptAt) + intervalMs) return null;
      state.lastAttemptAt = new Date(time).toISOString();
      if (manual) state.lastManualAt = state.lastAttemptAt;
      state.syncToken = token;
      state.syncExpiresAt = new Date(time + LEASE_MS).toISOString();
      return { playlistId: state.uploadsPlaylistId };
    });
    if (!claim) return;
    let result;
    try { result = await download(claim.playlistId); }
    catch (error) {
      await store.complete(token, { error: error.message });
      if (manual) throw httpError(error.message, 502);
      console.error("YouTube feed refresh failed:", error.message);
      return;
    }
    await store.complete(token, { ...result, fetchedAt: new Date(now()).toISOString() });
  }
  return {
    adminFeed,
    sync,
    async publicFeed() {
      const data = await adminFeed();
      const counts = { video: 0, short: 0, unknown: 0 };
      const items = data.items.filter(item => !item.hidden).filter(item => counts[item.format]++ < 20).map(publicItem);
      return { configured, items, fetchedAt: data.fetchedAt };
    },
    async update(id, input) {
      if (!/^[\w-]{11}$/.test(id)) throw httpError("Invalid video ID", 400);
      if (!input || typeof input !== "object" || Array.isArray(input) || !Object.keys(input).length || Object.keys(input).some(key => !["hidden", "hoverText", "format"].includes(key))) throw httpError("Only hidden, hoverText and format can be edited", 400);
      const changes = {};
      if (Object.hasOwn(input, "format")) {
        if (!["auto", "video", "short"].includes(input.format)) throw httpError("Format must be auto, video or short", 400);
        changes.formatOverride = input.format !== "auto";
        changes.format = changes.formatOverride ? input.format : await detectFormat(id) || "unknown";
      }
      if (Object.hasOwn(input,"hidden")) {
        if (typeof input.hidden !== "boolean") throw httpError("Hidden must be true or false", 400);
        changes.hidden = input.hidden;
      }
      if (Object.hasOwn(input,"hoverText")) {
        if (typeof input.hoverText !== "string" || input.hoverText.length > 120) throw httpError("Hover text must be 120 characters or fewer", 400);
        changes.hoverText = input.hoverText.trim();
      }
      const item = await store.update(id, changes);
      if (!item) throw httpError("Video not found in the current uploads feed", 404);
      return { ...publicItem(item), hidden: item.hidden, formatOverride: item.formatOverride };
    },
    start() {
      if (scheduler) return scheduler;
      const tick = () => { void sync().catch(() => console.error("YouTube sync storage is temporarily unavailable")); };
      tick();
      // Check for a due job; the persisted claim permits hourly external fetches only.
      scheduler = setInterval(tick, 60000);
      scheduler.unref?.();
      return scheduler;
    },
    stop() { if (scheduler) clearInterval(scheduler); scheduler = null; }
  };
}

const service = createYouTubeService();
export const getYouTubeFeed = () => service.publicFeed();
export const getAdminVideos = () => service.adminFeed();
export const syncYouTubeVideos = () => service.sync({ manual: true });
export const updateYouTubeVideo = (id, changes) => service.update(id, changes);
export const startYouTubeCacheScheduler = () => service.start();
export const stopYouTubeCacheScheduler = () => service.stop();
