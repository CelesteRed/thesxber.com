import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import sharp from "sharp";
import { isDatabaseReady, query } from "./db.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
dotenv.config({ path: path.join(projectDir, ".env") });

const extensionOrder = [".jpg", ".png", ".jpeg", ".webp", ".gif"];
const supportedExtensions = new Set(extensionOrder);
const mimeByExtension = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif"
};
const maxTitleLength = 120;
const maxHoverMarkdownLength = 2000;
const configuredWebpQuality = Number(process.env.WEBP_QUALITY || 82);
const webpQuality = Number.isFinite(configuredWebpQuality)
  ? Math.min(100, Math.max(1, Math.round(configuredWebpQuality)))
  : 82;

function normalizeTitle(value) {
  return String(value || "").trim().slice(0, maxTitleLength);
}

function normalizeHoverMarkdown(value) {
  return String(value || "").trim().slice(0, maxHoverMarkdownLength);
}

function resolveFromProject(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(projectDir, value);
}

// The directory is used to seed the database on first boot and as a local
// fallback when DATABASE_URL is intentionally omitted during development.
export const fanartDir = resolveFromProject(process.env.FANART_DIR, path.join(projectDir, "public", "fanart"));
export const metadataFile = resolveFromProject(process.env.FANART_METADATA_FILE, path.join(projectDir, "data", "fanart.json"));
export const webpCacheDir = resolveFromProject(process.env.FANART_WEBP_DIR, path.join(projectDir, "data", "fanart-webp"));

async function ensureFilesystemStorage() {
  await fs.mkdir(fanartDir, { recursive: true });
  await fs.mkdir(path.dirname(metadataFile), { recursive: true });
  try {
    await fs.access(metadataFile);
  } catch {
    await fs.writeFile(metadataFile, "{}\n", "utf8");
  }
}

async function ensureWebpCacheStorage() {
  await fs.mkdir(webpCacheDir, { recursive: true });
}

async function convertToWebp(buffer, extension) {
  return sharp(buffer, { animated: extension === ".gif" || extension === ".webp" })
    .webp({ quality: webpQuality })
    .toBuffer();
}

async function readMetadata() {
  try {
    return JSON.parse(await fs.readFile(metadataFile, "utf8"));
  } catch {
    return {};
  }
}

async function writeMetadata(metadata) {
  await fs.writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function extensionFor(filename) {
  return path.extname(filename).toLowerCase();
}

function safeFanartFilename(filename) {
  const value = path.basename(filename);
  if (!/^fanart\d+\.(jpg|jpeg|png|webp|gif)$/i.test(value)) return null;
  return value;
}

async function getStaticFiles() {
  await ensureFilesystemStorage();
  const files = await fs.readdir(fanartDir);
  const byIndex = new Map();
  for (const filename of files) {
    const match = /^fanart(\d+)\.(jpg|jpeg|png|webp|gif)$/i.exec(filename);
    if (!match) continue;
    const index = Number(match[1]);
    const extension = `.${match[2].toLowerCase()}`;
    const previous = byIndex.get(index);
    if (!previous || extensionOrder.indexOf(extension) < extensionOrder.indexOf(previous.extension)) {
      byIndex.set(index, { filename, extension, index });
    }
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

async function getFilesystemEntries() {
  const [files, metadata] = await Promise.all([getStaticFiles(), readMetadata()]);
  return files.map(({ filename, index }) => ({
    id: index,
    filename,
    url: `/fanart/${encodeURIComponent(filename)}`,
    originalUrl: `/fanart/${encodeURIComponent(filename)}?original=1`,
    title: metadata[filename]?.title || `Fanart ${index}`,
    hoverMarkdown: metadata[filename]?.hoverMarkdown || "",
    embedEligible: metadata[filename]?.embedEligible === true,
    uploadedAt: metadata[filename]?.uploadedAt || null
  }));
}

function formatDatabaseEntry(row) {
  const encodedFilename = encodeURIComponent(row.filename);
  return {
    id: row.id,
    filename: row.filename,
    url: `/fanart/${encodedFilename}`,
    originalUrl: `/fanart/${encodedFilename}?original=1`,
    title: row.title || `Fanart ${row.id}`,
    hoverMarkdown: row.hover_markdown || "",
    embedEligible: row.embed_eligible === true,
    uploadedAt: row.uploaded_at || null
  };
}

export async function seedFanartFromDisk() {
  if (!isDatabaseReady()) return 0;
  const countResult = await query("SELECT COUNT(*)::int AS count FROM fanart");
  if (countResult.rows[0].count > 0) return 0;
  const files = await getStaticFiles();
  let seeded = 0;
  for (const file of files) {
    const buffer = await fs.readFile(path.join(fanartDir, file.filename));
    const webpBuffer = await convertToWebp(buffer, file.extension);
    await query(
      `INSERT INTO fanart (filename, title, hover_markdown, mime_type, image_data, webp_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (filename) DO NOTHING`,
      [file.filename, `Fanart ${file.index}`, "", mimeByExtension[file.extension], buffer, webpBuffer]
    );
    seeded += 1;
  }
  return seeded;
}

export async function getFanartEntries({ includePrivate = false } = {}) {
  const visible = (entries) => includePrivate ? entries : entries.map(({ embedEligible, ...entry }) => entry);
  if (isDatabaseReady()) {
    const result = await query("SELECT id, filename, title, hover_markdown, embed_eligible, uploaded_at FROM fanart ORDER BY id");
    return visible(result.rows.map(formatDatabaseEntry));
  }
  return visible(await getFilesystemEntries());
}

export async function getFanartImage(filename, { original = false } = {}) {
  const safeName = safeFanartFilename(filename);
  if (!safeName) return null;

  if (isDatabaseReady()) {
    const result = await query("SELECT filename, mime_type, image_data, webp_data FROM fanart WHERE filename = $1", [safeName]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    const originalImage = {
      filename: row.filename,
      mimeType: row.mime_type,
      buffer: row.image_data
    };
    if (original) return originalImage;
    if (row.webp_data?.length) {
      return { filename: row.filename, mimeType: "image/webp", buffer: row.webp_data };
    }
    try {
      const webpBuffer = await convertToWebp(row.image_data, extensionFor(row.filename));
      await query("UPDATE fanart SET webp_data = $1 WHERE filename = $2 AND webp_data IS NULL", [webpBuffer, safeName]);
      return { filename: row.filename, mimeType: "image/webp", buffer: webpBuffer };
    } catch (error) {
      console.error(`Unable to convert ${safeName} to WebP:`, error.message);
      return originalImage;
    }
  }

  try {
    const extension = extensionFor(safeName);
    const originalBuffer = await fs.readFile(path.join(fanartDir, safeName));
    if (original) {
      return { filename: safeName, mimeType: mimeByExtension[extension], buffer: originalBuffer };
    }
    await ensureWebpCacheStorage();
    const cachePath = path.join(webpCacheDir, `${safeName}.webp`);
    try {
      return { filename: safeName, mimeType: "image/webp", buffer: await fs.readFile(cachePath) };
    } catch {
      const webpBuffer = await convertToWebp(originalBuffer, extension);
      await fs.writeFile(cachePath, webpBuffer);
      return { filename: safeName, mimeType: "image/webp", buffer: webpBuffer };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.error(`Unable to load ${safeName}:`, error.message);
    return null;
  }
}

async function saveOriginalAndWebp(buffer, filename, webpBuffer) {
  await ensureFilesystemStorage();
  await fs.writeFile(path.join(fanartDir, filename), buffer);
  await ensureWebpCacheStorage();
  await fs.writeFile(path.join(webpCacheDir, `${filename}.webp`), webpBuffer);
}

async function nextFanartIndex() {
  if (isDatabaseReady()) {
    const result = await query("SELECT COALESCE(MAX(CAST(substring(filename FROM 'fanart([0-9]+)') AS INTEGER)), 0) + 1 AS next FROM fanart");
    return Number(result.rows[0].next);
  }
  const entries = await getFilesystemEntries();
  return entries.reduce((highest, entry) => Math.max(highest, entry.id), 0) + 1;
}

export async function saveFanartBuffer(buffer, { extension, title = "", hoverMarkdown = "" } = {}) {
  if (!extension) throw new Error("Unsupported image type");
  const normalizedExtension = extension.toLowerCase().startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  if (!supportedExtensions.has(normalizedExtension)) throw new Error("Unsupported image type");
  const filename = `fanart${await nextFanartIndex()}${normalizedExtension}`;
  const normalizedTitle = normalizeTitle(title);
  const normalizedHoverMarkdown = normalizeHoverMarkdown(hoverMarkdown);
  const webpBuffer = await convertToWebp(buffer, normalizedExtension);

  if (isDatabaseReady()) {
    const result = await query(
      `INSERT INTO fanart (filename, title, hover_markdown, mime_type, image_data, webp_data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, filename, title, hover_markdown, embed_eligible, uploaded_at`,
      [filename, normalizedTitle, normalizedHoverMarkdown, mimeByExtension[normalizedExtension], buffer, webpBuffer]
    );
    return formatDatabaseEntry(result.rows[0]);
  }

  await saveOriginalAndWebp(buffer, filename, webpBuffer);
  const metadata = await readMetadata();
  metadata[filename] = { title: normalizedTitle, hoverMarkdown: normalizedHoverMarkdown, uploadedAt: new Date().toISOString() };
  await writeMetadata(metadata);
  const entries = await getFilesystemEntries();
  return entries.find((entry) => entry.filename === filename);
}

export async function updateFanartMetadata(filename, { title, hoverMarkdown, embedEligible } = {}) {
  const safeName = safeFanartFilename(filename);
  if (!safeName) throw new Error("Invalid fanart filename");
  const hasTitle = title !== undefined;
  const hasHoverMarkdown = hoverMarkdown !== undefined;
  const hasEmbedEligible = embedEligible !== undefined;
  if (hasEmbedEligible && typeof embedEligible !== "boolean") throw new Error("Embed eligibility must be a boolean");
  if (!hasTitle && !hasHoverMarkdown && !hasEmbedEligible) throw new Error("Provide a title, hover Markdown or embed eligibility value");

  if (isDatabaseReady()) {
    const current = await query("SELECT title, hover_markdown, embed_eligible FROM fanart WHERE filename = $1", [safeName]);
    if (!current.rows[0]) throw new Error("Fanart not found");
    const currentRow = current.rows[0];
    const result = await query(
      `UPDATE fanart
       SET title = $1, hover_markdown = $2, embed_eligible = $3
       WHERE filename = $4
       RETURNING id, filename, title, hover_markdown, embed_eligible, uploaded_at`,
      [
        hasTitle ? normalizeTitle(title) : currentRow.title,
        hasHoverMarkdown ? normalizeHoverMarkdown(hoverMarkdown) : currentRow.hover_markdown,
        hasEmbedEligible ? embedEligible : currentRow.embed_eligible,
        safeName
      ]
    );
    return formatDatabaseEntry(result.rows[0]);
  }

  await ensureFilesystemStorage();
  const [entries, metadata] = await Promise.all([getFilesystemEntries(), readMetadata()]);
  const existing = entries.find((entry) => entry.filename === safeName);
  if (!existing) throw new Error("Fanart not found");
  const currentMetadata = metadata[safeName] || {};
  metadata[safeName] = {
    ...currentMetadata,
    title: hasTitle ? normalizeTitle(title) : (currentMetadata.title || existing.title),
    hoverMarkdown: hasHoverMarkdown ? normalizeHoverMarkdown(hoverMarkdown) : (currentMetadata.hoverMarkdown || ""),
    embedEligible: hasEmbedEligible ? embedEligible : currentMetadata.embedEligible === true
  };
  await writeMetadata(metadata);
  return (await getFilesystemEntries()).find((entry) => entry.filename === safeName);
}

export async function removeFanart(filename) {
  const safeName = safeFanartFilename(filename);
  if (!safeName) throw new Error("Invalid fanart filename");

  if (isDatabaseReady()) {
    const result = await query("DELETE FROM fanart WHERE filename = $1", [safeName]);
    if (!result.rowCount) throw new Error("Fanart not found");
    return;
  }

  await fs.unlink(path.join(fanartDir, safeName));
  try { await fs.unlink(path.join(webpCacheDir, `${safeName}.webp`)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  await fs.rm(path.join(webpCacheDir, `embed-${safeName}.webp`), { force: true });
  const metadata = await readMetadata();
  delete metadata[safeName];
  await writeMetadata(metadata);
}

export function extensionFromUpload({ originalname = "", mimetype = "" } = {}) {
  const fromName = extensionFor(originalname);
  if (supportedExtensions.has(fromName)) return fromName;
  const byMime = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
  return byMime[mimetype] || null;
}
