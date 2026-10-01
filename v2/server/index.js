import "dotenv/config";
import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import sharp from "sharp";
import {
  completeDiscordLogin,
  destroyAdminSession,
  getAdminSession,
  internalActorFromRequest,
  listAdminActivity,
  logLogout,
  recordAdminActivity,
  startDiscordLogin
} from "./auth.js";
import { initializeDatabase, isDatabaseConfigured, isDatabaseReady } from "./db.js";
import { checkTwitchStatus, getLiveState, getPublicLive, startLiveTracking, stopLiveTracking, updateLiveConfig } from "./live.js";
import { extensionFromUpload, fanartDir, getFanartEntries, getFanartImage, removeFanart, saveFanartBuffer, seedFanartFromDisk, updateFanartMetadata } from "./fanart.js";
import { createIpRateLimiter, positiveInteger } from "./rate-limit.js";
import { getYouTubeFeed, startYouTubeCacheScheduler, stopYouTubeCacheScheduler } from "./youtube.js";
import { startDiscordBot } from "./discord-bot.js";
import { getArtworkOfTheHour, HOUR_MS, saveBannerCrop, prepareBannerCrop } from "./embed-art.js";
import { registerEmojiRoutes } from "./emoji-routes.js";
import { API_NOTES } from "../shared/api-notes.js";
import { registerVideoRoutes } from "./video-routes.js";
import { registerSiteAssetRecovery } from "./site-assets.js";
import { registerSxbertyRoutes } from "./sxberty-routes.js";
import { registerSxbertyFoodRoutes } from "./sxberty-food-routes.js";
import { registerSxbertyVoiceRoutes } from "./sxberty-voice-routes.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
const distDir = path.join(projectDir, "dist");
const port = Number(process.env.PORT || 8787);
export const app = express();
const maxUploadBytes = 15 * 1024 * 1024;

function parseTrustProxy(value) {
  if (value === "true") return true;
  if (value === "false" || !value) return false;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : false;
}

app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

const configuredOrigins = (process.env.CORS_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean);
const corsOptions = configuredOrigins.length
  ? { credentials: true, origin: (origin, callback) => callback(null, !origin || configuredOrigins.includes(origin)) }
  : undefined;
app.use(cors(corsOptions));

const apiRateLimit = createIpRateLimiter({
  windowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_SECONDS, 60) * 1000,
  maxRequests: positiveInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 120)
});
const authRateLimit = createIpRateLimiter({
  windowMs: positiveInteger(process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS, 900) * 1000,
  maxRequests: positiveInteger(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, 30),
  message: "Too many authentication requests. Please try again later."
});

// Keep API traffic bounded per resolved client IP while leaving cacheable site
// assets and fanart images available for normal browser loads.
app.use("/api", apiRateLimit);
app.use("/api/auth", authRateLimit);

function tokenMatches(expected, provided) {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function internalTokenMatches(request) {
  return tokenMatches(process.env.INTERNAL_API_TOKEN || "", request.get("x-internal-api-key") || "");
}

async function requireAdmin(request, response, next) {
  const internal = internalTokenMatches(request);
  if (internal) {
    request.adminUser = internalActorFromRequest(request);
    request.adminAuthType = "internal";
    return next();
  }
  try {
    const session = await getAdminSession(request);
    if (!session) return response.status(401).json({ error: "Discord login required" });
    request.adminUser = session;
    request.adminAuthType = "discord";
    return next();
  } catch (error) {
    console.error("Admin session lookup failed:", error.message);
    return response.status(503).json({ error: "Admin authentication is temporarily unavailable" });
  }
}

registerSxbertyFoodRoutes(app, requireAdmin);
registerSxbertyVoiceRoutes(app, requireAdmin);
// Media routes own their parsers so authentication and API limits run before
// allocating multipart buffers or decoding JSON metadata.
app.use(express.json({ limit: "1mb" }));

registerEmojiRoutes(app, requireAdmin);
registerSxbertyRoutes(app, requireAdmin);
app.get("/api/live", async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    await checkTwitchStatus();
    response.json({ ...await getPublicLive(), notes: API_NOTES });
  } catch (error) {
    console.error("Live status error:", error.message);
    response.status(503).json({ error: "Unable to load live status" });
  }
});

app.get("/api/admin/live", requireAdmin, async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const state = await getLiveState();
    response.json(state);
  } catch (error) {
    response.status(503).json({ error: "Unable to load live tracking settings" });
  }
});

app.patch("/api/admin/live", requireAdmin, async (request, response) => {
  try {
    const result = await updateLiveConfig(request.body);
    await recordAdminActivity(request, {
      action: "live.update",
      resourceType: "live",
      resourceId: "global",
      metadata: { fields: Object.keys(request.body || {}).filter(key => !key.toLowerCase().includes("secret") && key !== "config" && key !== "twitch" && key !== "tiktok") }
    });
    response.json(result);
  } catch (error) {
    response.status(400).json({ error: error.message || "Unable to save live tracking settings" });
  }
});

registerVideoRoutes(app, requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes },
  fileFilter: (request, file, callback) => callback(null, Boolean(extensionFromUpload(file)))
});

app.get("/api/health", (request, response) => response.json({
  ok: true,
  service: "thesxber-v2",
  notes: API_NOTES,
  database: isDatabaseReady() ? "ready" : (isDatabaseConfigured() ? "starting" : "filesystem-fallback")
}));

async function sendAuthSession(request, response) {
  try {
    response.set("Cache-Control", "no-store");
    const user = await getAdminSession(request);
    response.json({ ok: true, authenticated: Boolean(user), user: user || null });
  } catch (error) {
    console.error("Admin session lookup failed:", error.message);
    response.status(503).json({ error: "Admin authentication is temporarily unavailable" });
  }
}

app.get("/api/auth/session", sendAuthSession);
app.get("/api/admin/access", sendAuthSession);

app.get("/api/auth/discord", (request, response) => {
  try {
    response.redirect(302, startDiscordLogin(request, response));
  } catch (error) {
    console.error("Discord OAuth configuration error:", error.message);
    response.redirect(302, "/admin?auth=unconfigured");
  }
});

app.get("/api/auth/discord/callback", async (request, response) => {
  try {
    const result = await completeDiscordLogin(request, response);
    response.redirect(302, result.allowed ? "/admin?auth=success" : "/admin?auth=denied");
  } catch (error) {
    console.error("Discord OAuth callback failed:", error.message);
    response.redirect(302, "/admin?auth=error");
  }
});

app.post("/api/auth/logout", async (request, response) => {
  try {
    const user = await getAdminSession(request);
    if (user) await logLogout(request, user);
    await destroyAdminSession(request, response);
    response.json({ ok: true });
  } catch (error) {
    console.error("Admin logout failed:", error.message);
    response.status(503).json({ error: "Unable to sign out right now" });
  }
});

app.get("/api/youtube", async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    response.json({ ...await getYouTubeFeed(), notes: API_NOTES });
  } catch (error) {
    console.error("YouTube feed error:", error.message);
    response.status(502).json({ error: "Unable to load YouTube feed" });
  }
});

app.get("/api/fanart", async (request, response) => {
  try {
    response.json({ items: await getFanartEntries(), notes: API_NOTES });
  } catch (error) {
    console.error("Fanart listing error:", error.message);
    response.status(500).json({ error: "Unable to load fanart" });
  }
});

app.get("/api/admin/fanart", requireAdmin, async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    response.json({ items: await getFanartEntries({ includePrivate: true }) });
  } catch (error) {
    console.error("Admin fanart listing error:", error.message);
    response.status(503).json({ error: "Unable to load fanart settings" });
  }
});

app.get(["/artoftheday.webp", "/api/artoftheday.webp"], async (request, response) => {
  response.set("Cache-Control", "no-cache, must-revalidate");
  try {
    const image = await getArtworkOfTheHour();
    if (!image) return response.status(404).send("No artwork is selected for embeds");
    response.type("image/webp").send(image.buffer);
  } catch (error) {
    console.error("Embed image error:", error.message);
    response.status(503).send("Embed image temporarily unavailable");
  }
});

app.post("/api/admin/fanart", requireAdmin, upload.single("file"), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: "Upload an image file" });
  try {
    const item = await saveFanartBuffer(request.file.buffer, {
      extension: extensionFromUpload(request.file),
      title: request.body.title || "",
      hoverMarkdown: request.body.hoverMarkdown || "",
      creditUrl: request.body.creditUrl || ""
    });
    await recordAdminActivity(request, {
      action: "fanart.upload",
      resourceType: "fanart",
      resourceId: item.filename,
      metadata: { title: item.title, hasHoverMarkdown: Boolean(item.hoverMarkdown), mimeType: request.file.mimetype, sizeBytes: request.file.size }
    });
    response.status(201).json({ item });
  } catch (error) {
    response.status(400).json({ error: error.message || "Unable to save fanart" });
  }
});

app.patch("/api/admin/fanart/:filename", requireAdmin, async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const hasCrop = Object.hasOwn(request.body || {}, "embedCrop");
    const preparedEmbed = hasCrop ? await prepareBannerCrop(request.params.filename, request.body.embedCrop) : undefined;
    const item = await updateFanartMetadata(request.params.filename, {
      title: request.body?.title,
      hoverMarkdown: request.body?.hoverMarkdown,
      embedEligible: request.body?.embedEligible,
      creditUrl: request.body?.creditUrl
    }, preparedEmbed);
    await recordAdminActivity(request, {
      action: "fanart.update",
      resourceType: "fanart",
      resourceId: item.filename,
      metadata: {
        fields: [
          request.body?.title !== undefined ? "title" : null,
          request.body?.hoverMarkdown !== undefined ? "hoverMarkdown" : null,
          request.body?.embedEligible !== undefined ? "embedEligible" : null,
          request.body?.creditUrl !== undefined ? "creditUrl" : null,
          hasCrop ? "embedCrop" : null
        ].filter(Boolean),
        ...(request.body?.embedEligible !== undefined ? { embedEligible: item.embedEligible } : {}),
        ...(hasCrop ? { crop: item.embedCrop, mode: item.embedCrop ? "manual" : "automatic" } : {})
      }
    });
    response.json({ item });
  } catch (error) {
    response.status(400).json({ error: error.message || "Unable to update fanart" });
  }
});

app.get("/api/admin/fanart/:filename/crop-source", requireAdmin, async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const image = await getFanartImage(request.params.filename, { original: true });
    if (!image) return response.status(404).send("Fanart not found");
    // A static, oriented source keeps animated/EXIF images identical to the saved crop.
    response.type("png").send(await sharp(image.buffer).rotate().png().toBuffer());
  } catch {
    response.status(400).send("Unable to prepare crop preview");
  }
});

app.put("/api/admin/fanart/:filename/embed-crop", requireAdmin, async (request, response) => {
  response.set("Cache-Control", "no-store");
  try {
    const item = await saveBannerCrop(request.params.filename, request.body?.crop);
    await recordAdminActivity(request, {
      action: "fanart.crop", resourceType: "fanart", resourceId: item.filename,
      metadata: { crop: item.embedCrop, mode: item.embedCrop ? "manual" : "automatic" }
    });
    response.json({ item });
  } catch (error) {
    response.status(400).json({ error: error.message || "Unable to save banner crop" });
  }
});

app.delete("/api/admin/fanart/:filename", requireAdmin, async (request, response) => {
  try {
    await removeFanart(request.params.filename);
    await recordAdminActivity(request, {
      action: "fanart.delete",
      resourceType: "fanart",
      resourceId: request.params.filename
    });
    response.json({ ok: true });
  } catch (error) {
    response.status(404).json({ error: error.message || "Fanart not found" });
  }
});

app.get("/api/admin/activity", requireAdmin, async (request, response) => {
  try {
    response.set("Cache-Control", "no-store");
    response.json({ items: await listAdminActivity(request.query.limit) });
  } catch (error) {
    console.error("Activity ledger read failed:", error.message);
    response.status(500).json({ error: "Unable to load the activity ledger" });
  }
});

app.get("/fanart/:filename", async (request, response, next) => {
  try {
    const original = request.query.original === "1" || request.query.original === "true";
    const image = await getFanartImage(request.params.filename, { original });
    if (image) {
      response.set("Content-Type", image.mimeType);
      response.set("Cache-Control", original ? "private, max-age=300" : "public, max-age=3600");
      return response.send(image.buffer);
    }
    if (isDatabaseReady()) return response.status(404).send("Fanart not found");
    next();
  } catch (error) {
    console.error("Fanart image error:", error.message);
    response.status(500).send("Unable to load fanart");
  }
});

function escapeHtmlAttribute(value) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

// Link-preview crawlers read the initial HTML without running React. Resolve
// absolute preview URLs at runtime so raw-IP hosting and domain hosting work.
function sendSitePage(request, response) {
  const indexFile = path.join(distDir, "index.html");
  if (!fs.existsSync(indexFile)) return response.status(404).send("Build the v2 app with npm run build first.");
  let origin;
  try {
    const publicUrl = new URL(process.env.PUBLIC_SITE_URL || `${request.protocol}://${request.get("host")}`);
    if (!["http:", "https:"].includes(publicUrl.protocol)) throw new Error("Invalid site protocol");
    origin = publicUrl.origin;
  } catch {
    return response.status(400).send("Invalid public site URL");
  }
  const pagePath = request.path === "/index.html" ? "/" : request.path;
  const html = fs.readFileSync(indexFile, "utf8")
    .replaceAll("__SITE_ORIGIN__", escapeHtmlAttribute(origin))
    .replaceAll("__PAGE_URL__", escapeHtmlAttribute(`${origin}${pagePath}`))
    .replaceAll("__EMBED_HOUR__", String(Math.floor(Date.now() / HOUR_MS)));
  response.set("Cache-Control", "no-store");
  response.type("html").send(html);
}

app.get(/^\/(admin|fanart)\/?$/, sendSitePage);
app.get(["/", "/index.html"], sendSitePage);

// This fallback serves seeded images while local development runs without DB.
app.use("/fanart", express.static(fanartDir, { maxAge: "1h" }));
if (fs.existsSync(distDir)) app.use(express.static(distDir, { index: false }));
registerSiteAssetRecovery(app, distDir);
app.get(/.*/, sendSitePage);

async function waitForDatabase() {
  if (!isDatabaseConfigured()) return false;
  const attempts = Math.max(1, Number(process.env.DATABASE_STARTUP_RETRIES || 20));
  const delayMs = Math.max(250, Number(process.env.DATABASE_STARTUP_DELAY_MS || 1500));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await initializeDatabase();
      return true;
    } catch (error) {
      if (attempt === attempts) throw error;
      console.warn(`Database is not ready yet (attempt ${attempt}/${attempts}); retrying…`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

export async function startServer() {
  await waitForDatabase();
  const seeded = await seedFanartFromDisk();
  if (seeded) console.info(`Seeded ${seeded} fanart images into PostgreSQL.`);
  const server = app.listen(port, () => console.info(`thesxber v2 API listening on http://localhost:${port}`));
  startYouTubeCacheScheduler();
  startLiveTracking();

  let discordClient = null;
  startDiscordBot().then((client) => { discordClient = client; }).catch((error) => console.error("Discord bot startup error:", error.message));

  async function shutdown() {
    stopYouTubeCacheScheduler();
    stopLiveTracking();
    discordClient?.destroy();
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error("Server startup failed:", error);
    process.exitCode = 1;
  });
}
