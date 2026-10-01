import { identifyVideoFormats } from "./youtube-format.js";
import { enrichPreviewCounts } from "./youtube-preview-counts.js";

// A read-only local preview adapter for older deployed feeds without formats.
export function liveYouTubePreview(origin, { fetcher = fetch, identify = identifyVideoFormats, enrichCounts = enrichPreviewCounts, now = Date.now } = {}) {
  let cached = null;
  let expires = 0;
  let pending;
  async function feed() {
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetcher(new URL("/api/youtube", origin), { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Live video feed unavailable");
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error("Invalid live video feed");
      const missing = data.items.filter(item => !["video", "short"].includes(item.format));
      const [formats, counted] = await Promise.all([identify(missing), enrichCounts(data.items)]);
      const identified = new Map(formats.map(item => [item.id, item]));
      cached = { ...data, items: counted.map(item => ({ ...item, ...(identified.has(item.id) ? { format: identified.get(item.id).format, videoUrl: identified.get(item.id).videoUrl || item.videoUrl } : {}) })) };
      expires = now() + (cached.items.some(item => item.format === "unknown" || !/^\d+$/.test(String(item.viewCount))) ? 60000 : 3600000);
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  }
  function install(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url?.split("?")[0] !== "/api/youtube") return next();
      if (request.method !== "GET") { response.writeHead(405, { Allow: "GET" }); response.end(); return; }
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      try { response.end(JSON.stringify(await feed())); }
      catch { response.statusCode = 503; response.end(JSON.stringify({ error: "Live video feed temporarily unavailable" })); }
    });
  }
  return { name: "live-youtube-preview", configureServer: install, configurePreviewServer: install };
}
