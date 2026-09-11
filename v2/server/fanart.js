import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
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

async function ensureFilesystemStorage() {
  await fs.mkdir(fanartDir, { recursive: true });
  await fs.mkdir(path.dirname(metadataFile), { recursive: true });
  try {
    await fs.access(metadataFile);
  } catch {
    await fs.writeFile(metadataFile, "{}\n", "utf8");
  }
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
    title: metadata[filename]?.title || `Fanart ${index}`,
    hoverMarkdown: metadata[filename]?.hoverMarkdown || "",
    uploadedAt: metadata[filename]?.uploadedAt || null
  }));
}

function formatDatabaseEntry(row) {
  return {
    id: row.id,
    filename: row.filename,
    url: `/fanart/${encodeURIComponent(row.filename)}`,
    title: row.title || `Fanart ${row.id}`,
    hoverMarkdown: row.hover_markdown || "",
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
    await query(
      `INSERT INTO fanart (filename, title, hover_markdown, mime_type, image_data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (filename) DO NOTHING`,
      [file.filename, `Fanart ${file.index}`, "", mimeByExtension[file.extension], buffer]
    );
    seeded += 1;
  }
  return seeded;
}

export async function getFanartEntries() {
  if (isDatabaseReady()) {
    const result = await query("SELECT id, filename, title, hover_markdown, uploaded_at FROM fanart ORDER BY id");
    return result.rows.map(formatDatabaseEntry);
  }
  return getFilesystemEntries();
}

export async function getFanartImage(filename) {
  const safeName = safeFanartFilename(filename);
  if (!safeName) return null;

  if (isDatabaseReady()) {
    const result = await query("SELECT filename, mime_type, image_data FROM fanart WHERE filename = $1", [safeName]);
    if (!result.rows[0]) return null;
    return {
      filename: result.rows[0].filename,
      mimeType: result.rows[0].mime_type,
      buffer: result.rows[0].image_data
    };
  }

  try {
    const extension = extensionFor(safeName);
    return { filename: safeName, mimeType: mimeByExtension[extension], buffer: await fs.readFile(path.join(fanartDir, safeName)) };
  } catch {
    return null;
  }
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

  if (isDatabaseReady()) {
    const result = await query(
      `INSERT INTO fanart (filename, title, hover_markdown, mime_type, image_data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, filename, title, hover_markdown, uploaded_at`,
      [filename, normalizedTitle, normalizedHoverMarkdown, mimeByExtension[normalizedExtension], buffer]
    );
    return formatDatabaseEntry(result.rows[0]);
  }

  await ensureFilesystemStorage();
  await fs.writeFile(path.join(fanartDir, filename), buffer);
  const metadata = await readMetadata();
  metadata[filename] = { title: normalizedTitle, hoverMarkdown: normalizedHoverMarkdown, uploadedAt: new Date().toISOString() };
  await writeMetadata(metadata);
  const entries = await getFilesystemEntries();
  return entries.find((entry) => entry.filename === filename);
}

export async function updateFanartMetadata(filename, { title, hoverMarkdown } = {}) {
  const safeName = safeFanartFilename(filename);
  if (!safeName) throw new Error("Invalid fanart filename");
  const hasTitle = title !== undefined;
  const hasHoverMarkdown = hoverMarkdown !== undefined;
  if (!hasTitle && !hasHoverMarkdown) throw new Error("Provide a title or hover Markdown value");

  if (isDatabaseReady()) {
    const current = await query("SELECT title, hover_markdown FROM fanart WHERE filename = $1", [safeName]);
    if (!current.rows[0]) throw new Error("Fanart not found");
    const currentRow = current.rows[0];
    const result = await query(
      `UPDATE fanart
       SET title = $1, hover_markdown = $2
       WHERE filename = $3
       RETURNING id, filename, title, hover_markdown, uploaded_at`,
      [
        hasTitle ? normalizeTitle(title) : currentRow.title,
        hasHoverMarkdown ? normalizeHoverMarkdown(hoverMarkdown) : currentRow.hover_markdown,
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
    hoverMarkdown: hasHoverMarkdown ? normalizeHoverMarkdown(hoverMarkdown) : (currentMetadata.hoverMarkdown || "")
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
