import "dotenv/config";
import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { extensionFromUpload, fanartDir, getFanartEntries, removeFanart, saveFanartBuffer } from "./fanart.js";
import { startDiscordBot } from "./discord-bot.js";

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

const allowedAdminIps = new Set(
  (process.env.ADMIN_ALLOWED_IPS || "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean)
);

const configuredOrigins = (process.env.CORS_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean);
const corsOptions = configuredOrigins.length
  ? { origin: (origin, callback) => callback(null, !origin || configuredOrigins.includes(origin)) }
  : undefined;
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

function adminTokenMatches(request) {
  const expected = process.env.ADMIN_API_TOKEN || "";
  const provided = (request.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function normalizeIp(ip) {
  const value = String(ip || "").trim().toLowerCase();
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}

function adminIpMatches(request) {
  if (!allowedAdminIps.size) return false;
  const requestIp = normalizeIp(request.ip);
  return [...allowedAdminIps].some((allowedIp) => normalizeIp(allowedIp) === requestIp);
}

function requireAdminIp(request, response, next) {
  if (!adminIpMatches(request)) return response.status(403).json({ error: "Admin access is not available from this IP" });
  next();
}

function requireAdminPageIp(request, response, next) {
  if (!adminIpMatches(request)) return response.redirect(302, "/");
  next();
}

function requireAdmin(request, response, next) {
  if (!adminIpMatches(request)) return response.status(403).json({ error: "Admin access is not available from this IP" });
  if (!adminTokenMatches(request)) return response.status(401).json({ error: "Invalid admin token" });
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes },
  fileFilter: (request, file, callback) => callback(null, Boolean(extensionFromUpload(file)))
});

app.get("/api/health", (request, response) => response.json({ ok: true, service: "thesxber-v2" }));

app.get("/api/admin/access", requireAdminIp, (request, response) => response.json({ ok: true }));

app.get("/api/youtube", async (request, response) => {
  const key = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!key || !channelId) return response.json({ configured: false, items: [] });

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.search = new URLSearchParams({ key, channelId, part: "snippet,id", order: "date", maxResults: "20" });
    const youtubeResponse = await fetch(url);
    if (!youtubeResponse.ok) throw new Error(`YouTube responded with ${youtubeResponse.status}`);
    const data = await youtubeResponse.json();
    const items = (data.items || [])
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
        videoUrl: `https://www.youtube.com/watch?v=${item.id.videoId}`
      }));
    response.json({ configured: true, items });
  } catch (error) {
    console.error("YouTube feed error:", error.message);
    response.status(502).json({ error: "Unable to load YouTube feed" });
  }
});

app.get("/api/fanart", async (request, response) => {
  try {
    response.json({ items: await getFanartEntries() });
  } catch (error) {
    console.error("Fanart listing error:", error.message);
    response.status(500).json({ error: "Unable to load fanart" });
  }
});

app.post("/api/admin/fanart", requireAdmin, upload.single("file"), async (request, response) => {
  if (!request.file) return response.status(400).json({ error: "Upload an image file" });
  try {
    const item = await saveFanartBuffer(request.file.buffer, { extension: extensionFromUpload(request.file), title: request.body.title || "" });
    response.status(201).json({ item });
  } catch (error) {
    response.status(400).json({ error: error.message || "Unable to save fanart" });
  }
});

app.delete("/api/admin/fanart/:filename", requireAdmin, async (request, response) => {
  try {
    await removeFanart(request.params.filename);
    response.json({ ok: true });
  } catch (error) {
    response.status(404).json({ error: error.message || "Fanart not found" });
  }
});

app.get(/^\/admin\/?$/, requireAdminPageIp, (request, response) => {
  const indexFile = path.join(distDir, "index.html");
  if (!fs.existsSync(indexFile)) return response.status(404).send("Build the v2 app with npm run build first.");
  response.sendFile(indexFile);
});

app.use("/fanart", express.static(fanartDir, { maxAge: "1h" }));
if (fs.existsSync(distDir)) app.use(express.static(distDir));
app.get(/.*/, (request, response) => {
  if (fs.existsSync(path.join(distDir, "index.html"))) return response.sendFile(path.join(distDir, "index.html"));
  response.status(404).send("Build the v2 app with npm run build first.");
});

export function startServer() {
  const server = app.listen(port, () => console.info(`thesxber v2 API listening on http://localhost:${port}`));
  startDiscordBot().catch((error) => console.error("Discord bot startup error:", error.message));

  function shutdown() { server.close(() => process.exit(0)); }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
