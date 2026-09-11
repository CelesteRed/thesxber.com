import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");
dotenv.config({ path: path.join(projectDir, ".env") });
const extensionOrder = [".jpg", ".png", ".jpeg", ".webp", ".gif"];
const supportedExtensions = new Set(extensionOrder);

function resolveFromProject(value, fallback) {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(projectDir, value);
}

export const fanartDir = resolveFromProject(process.env.FANART_DIR, path.join(projectDir, "public", "fanart"));
export const metadataFile = resolveFromProject(process.env.FANART_METADATA_FILE, path.join(projectDir, "data", "fanart.json"));

export async function ensureFanartStorage() {
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

export async function getFanartEntries() {
  await ensureFanartStorage();
  const [files, metadata] = await Promise.all([fs.readdir(fanartDir), readMetadata()]);
  const byIndex = new Map();

  for (const filename of files) {
    const match = /^fanart(\d+)\.(jpg|jpeg|png|webp|gif)$/i.exec(filename);
    if (!match) continue;
    const index = Number(match[1]);
    const extension = `.${match[2].toLowerCase()}`;
    if (!supportedExtensions.has(extension)) continue;
    const previous = byIndex.get(index);
    if (!previous || extensionOrder.indexOf(extension) < extensionOrder.indexOf(previous.extension)) {
      byIndex.set(index, { filename, extension, index });
    }
  }

  return [...byIndex.values()]
    .sort((a, b) => a.index - b.index)
    .map(({ filename, index }) => ({
      id: index,
      filename,
      url: `/fanart/${encodeURIComponent(filename)}`,
      title: metadata[filename]?.title || `Fanart ${index}`,
      uploadedAt: metadata[filename]?.uploadedAt || null
    }));
}

async function nextFanartIndex() {
  const entries = await getFanartEntries();
  return entries.reduce((highest, entry) => Math.max(highest, entry.id), 0) + 1;
}

export async function saveFanartBuffer(buffer, { extension, title = "" } = {}) {
  await ensureFanartStorage();
  if (!extension) throw new Error("Unsupported image type");
  const normalizedExtension = extension.toLowerCase().startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  if (!supportedExtensions.has(normalizedExtension)) throw new Error("Unsupported image type");
  const filename = `fanart${await nextFanartIndex()}${normalizedExtension}`;
  await fs.writeFile(path.join(fanartDir, filename), buffer);
  const metadata = await readMetadata();
  metadata[filename] = { title: String(title || "").slice(0, 120), uploadedAt: new Date().toISOString() };
  await writeMetadata(metadata);
  const entries = await getFanartEntries();
  return entries.find((entry) => entry.filename === filename);
}

export async function removeFanart(filename) {
  const safeName = safeFanartFilename(filename);
  if (!safeName) throw new Error("Invalid fanart filename");
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
