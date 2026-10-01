// YouTube's public Shorts route redirects long-form videos to /watch.
// Do not infer a format from titles, thumbnails, or duration alone.
export function createFormatDetector({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const pending = new Map();
  return async function detect(id) {
    if (!/^[\w-]{11}$/.test(id || "")) return null;
    const saved = cache.get(id);
    if (saved && saved.expires > now()) return saved.format;
    if (pending.has(id)) return pending.get(id);
    const task = (async () => {
      let format = null;
      try {
        const response = await fetcher(`https://www.youtube.com/shorts/${id}`, {
          redirect: "manual", signal: AbortSignal.timeout(12000)
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = new URL(response.headers.get("location") || "", "https://www.youtube.com");
          if (["www.youtube.com", "youtube.com"].includes(location.hostname) && location.pathname === "/watch" && location.searchParams.get("v") === id) format = "video";
          await response.body?.cancel();
        } else if (response.status === 200) {
          // Only the head is needed; don't download the player or its scripts.
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let html = "";
          try {
            while (html.length < 2097152) {
              const { value, done } = await reader.read();
              if (done) break;
              html += decoder.decode(value, { stream: true });
              if (/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["'][^"']+["']/i.test(html) || html.includes("</head>")) break;
            }
          } finally { await reader.cancel(); }
          const canonical = html.match(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']+)["']/i)?.[1];
          if (canonical === `https://www.youtube.com/shorts/${id}`) format = "short";
          else if (canonical === `https://www.youtube.com/watch?v=${id}`) format = "video";
        } else { await response.body?.cancel(); }
      } catch { /* Timeouts, consent and provider errors are unknown, never Videos. */ }
      if (cache.size >= 5000) cache.delete(cache.keys().next().value);
      cache.set(id, { format, expires: now() + (format ? 86400000 : 60000) });
      return format;
    })();
    pending.set(id, task);
    try { return await task; } finally { pending.delete(id); }
  };
}

export const detectYouTubeFormat = createFormatDetector();

export async function identifyVideoFormats(items, detect = detectYouTubeFormat) {
  const result = [...items];
  let next = 0;
  const deadline = Date.now() + 60000;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      const detected = Date.now() < deadline ? await detect(item.id) : null;
      const format = detected || item.format || "unknown";
      result[index] = { ...item, format, ...(format === "short" ? { videoUrl: `https://www.youtube.com/shorts/${item.id}` } : {}) };
    }
  }));
  return result;
}
