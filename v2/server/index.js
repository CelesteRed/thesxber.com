import "dotenv/config";
import cors from "cors";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { closeDatabase, initializeDatabase, isDatabaseConfigured, isDatabaseReady } from "./db.js";
import { extensionFromUpload, fanartDir, getFanartEntries, getFanartImage, removeFanart, saveFanartBuffer, seedFanartFromDisk } from "./fanart.js";
import { getYouTubeFeed, startYouTubeCacheScheduler, stopYouTubeCacheScheduler } from "./youtube.js";
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

function normalizeIp(ip) {
  const value = String(ip || "").trim().toLowerCase();
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}

function adminIpMatches(request) {
  if (!allowedAdminIps.size) return false;
  const requestIp = normalizeIp(request.ip);
  return [...allowedAdminIps].some((allowedIp) => normalizeIp(allowedIp) === requestIp);
}

function tokenMatches(expected, provided) {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function adminTokenMatches(request) {
  const provided = (request.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return tokenMatches(process.env.ADMIN_API_TOKEN || "", provided);
}

function internalTokenMatches(request) {
  return tokenMatches(process.env.INTERNAL_API_TOKEN || "", request.get("x-internal-api-key") || "");
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
  const internal = internalTokenMatches(request);
  if (!internal && !adminIpMatches(request)) return response.status(403).json({ error: "Admin access is not available from this IP" });
  if (!internal && !adminTokenMatches(request)) return response.status(401).json({ error: "Invalid admin token" });
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxUploadBytes },
  fileFilter: (request, file, callback) => callback(null, Boolean(extensionFromUpload(file)))
});

app.get("/api/health", (request, response) => response.json({
  ok: true,
  service: "thesxber-v2",
  database: isDatabaseReady() ? "ready" : (isDatabaseConfigured() ? "starting" : "filesystem-fallback")
}));

app.get("/api/admin/access", requireAdminIp, (request, response) => response.json({ ok: true }));

app.get("/api/youtube", async (request, response) => {
  try {
    response.json(await getYouTubeFeed());
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
    const item = await saveFanartBuffer(request.file.buffer, {
      extension: extensionFromUpload(request.file),
      title: request.body.title || ""
    });
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

app.get("/fanart/:filename", async (request, response, next) => {
  try {
    const image = await getFanartImage(request.params.filename);
    if (image) {
      response.set("Content-Type", image.mimeType);
      response.set("Cache-Control", "public, max-age=3600");
      return response.send(image.buffer);
    }
    if (isDatabaseReady()) return response.status(404).send("Fanart not found");
    next();
  } catch (error) {
    console.error("Fanart image error:", error.message);
    response.status(500).send("Unable to load fanart");
  }
});

app.get(/^\/admin\/?$/, requireAdminPageIp, (request, response) => {
  const indexFile = path.join(distDir, "index.html");
  if (!fs.existsSync(indexFile)) return response.status(404).send("Build the v2 app with npm run build first.");
  response.sendFile(indexFile);
});

// This fallback serves seeded images while local development runs without DB.
app.use("/fanart", express.static(fanartDir, { maxAge: "1h" }));
if (fs.existsSync(distDir)) app.use(express.static(distDir));
app.get(/.*/, (request, response) => {
  const indexFile = path.join(distDir, "index.html");
  if (fs.existsSync(indexFile)) return response.sendFile(indexFile);
  response.status(404).send("Build the v2 app with npm run build first.");
});

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

  let discordClient = null;
  startDiscordBot().then((client) => { discordClient = client; }).catch((error) => console.error("Discord bot startup error:", error.message));

  async function shutdown() {
    stopYouTubeCacheScheduler();
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
