const DEFAULT_MAX_BUCKETS = 10_000;

function normalizeIp(value) {
  const address = String(value || "unknown");
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

export function clientIp(request) {
  return normalizeIp(request.ip || request.socket?.remoteAddress || "unknown");
}

/**
 * Create a small, dependency-free fixed-window limiter keyed by the client IP.
 * The app currently runs as one container, so an in-memory store is sufficient.
 * A shared store should replace this when the API is scaled across processes.
 */
export function createIpRateLimiter({
  windowMs = 60_000,
  maxRequests = 120,
  maxBuckets = DEFAULT_MAX_BUCKETS,
  message = "Too many requests. Please try again later."
} = {}) {
  const intervalMs = Math.max(1_000, Math.floor(Number(windowMs) || 60_000));
  const limit = Math.max(1, Math.floor(Number(maxRequests) || 120));
  const bucketLimit = Math.max(100, Math.floor(Number(maxBuckets) || DEFAULT_MAX_BUCKETS));
  const buckets = new Map();
  let nextCleanupAt = 0;

  function cleanup(now) {
    if (now < nextCleanupAt) return;
    nextCleanupAt = now + Math.min(intervalMs, 10_000);
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  function evictIfNeeded() {
    while (buckets.size > bucketLimit) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) return;
      buckets.delete(oldestKey);
    }
  }

  const middleware = (request, response, next) => {
    const now = Date.now();
    cleanup(now);

    const key = clientIp(request);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + intervalMs };
      buckets.set(key, bucket);
      evictIfNeeded();
    }

    bucket.count += 1;
    const retryAfter = Math.max(0, Math.ceil((bucket.resetAt - now) / 1000));
    const remaining = Math.max(0, limit - bucket.count);
    response.set({
      "RateLimit-Limit": String(limit),
      "RateLimit-Remaining": String(remaining),
      "RateLimit-Reset": String(retryAfter)
    });

    if (bucket.count > limit) {
      response.set("Retry-After", String(retryAfter));
      return response.status(429).json({ error: message });
    }
    return next();
  };

  // Useful for graceful shutdowns and isolated tests without exposing the map.
  middleware.reset = () => buckets.clear();
  return middleware;
}

export function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
