// Preview-only fallback for legacy feeds. Production uses videos.list statistics.
export function publicViewCount(html, id) {
  const marker = /(?:var\s+)?ytInitialPlayerResponse\s*=\s*\{/.exec(html);
  if (!marker) return null;
  const start = marker.index + marker[0].lastIndexOf('{');
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) {
      try {
        const details = JSON.parse(html.slice(start, index + 1)).videoDetails;
        return details?.videoId === id && /^\d+$/.test(details.viewCount ?? '') ? String(details.viewCount) : null;
      } catch { return null; }
    }
  }
  return null;
}

export async function enrichPreviewCounts(items, { fetcher = fetch } = {}) {
  const result = [...items];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (/^\d+$/.test(String(item.viewCount)) || !/^[\w-]{11}$/.test(item.id || '')) continue;
      try {
        const response = await fetcher(`https://www.youtube.com/watch?v=${item.id}`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) { await response.body?.cancel(); continue; }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let html = '', bytes = 0;
        try {
          while (bytes < 2097152) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            html += decoder.decode(value, { stream: true });
          }
        } finally { await reader.cancel(); }
        result[index] = { ...item, viewCount: publicViewCount(html, item.id) };
      } catch { /* Keep the video usable if public metadata is unavailable. */ }
    }
  }));
  return result;
}
