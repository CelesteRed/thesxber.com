import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { isDatabaseReady, query } from "./db.js";

dotenv.config();
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(moduleDir, "..");
const liveConfigFile = process.env.LIVE_CONFIG_FILE
  ? (path.isAbsolute(process.env.LIVE_CONFIG_FILE) ? process.env.LIVE_CONFIG_FILE : path.resolve(projectDir, process.env.LIVE_CONFIG_FILE))
  : path.join(projectDir, "data", "live.json");
const defaultConfig = {
  twitch: { login: "", enabled: false, clientId: "", clientSecret: "", pollIntervalSeconds: 300 },
  tiktok: { handle: "", enabled: false, live: false, title: "" }
};
const defaultStatus = {
  twitch: { live: false, title: "", url: "", checkedAt: null, stale: false },
  tiktok: { live: false, title: "", url: "", checkedAt: null, stale: false }
};
const minimumPollSeconds = 60;
const maximumPollSeconds = 86_400;
const minimumPollMs = minimumPollSeconds * 1000;
let pollTimer = null;
let pollInProgress = false;
let memoryState = { config: structuredClone(defaultConfig), status: structuredClone(defaultStatus) };

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeTwitchLogin(value) {
  if (value !== undefined && typeof value !== "string") throw new Error("Twitch login must be a string");
  const login = String(value ?? "").trim().replace(/^@+/, "").toLowerCase();
  if (!login) return "";
  if (!/^[a-z0-9_]{1,25}$/.test(login)) throw new Error("Twitch login must be 1-25 letters, numbers, or underscores");
  return login;
}
function normalizeTwitchClientId(value) {
  if (value !== undefined && typeof value !== "string") throw new Error("Twitch client ID must be a string");
  const clientId = String(value ?? "").trim();
  if (!clientId) return "";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(clientId)) throw new Error("Twitch client ID must be 1-128 safe characters");
  return clientId;
}
function normalizeTwitchClientSecret(value) {
  if (value !== undefined && typeof value !== "string") throw new Error("Twitch client secret must be a string");
  const clientSecret = String(value ?? "").trim();
  if (!clientSecret) return "";
  if (clientSecret.length > 256 || /[\u0000-\u001f\u007f]/.test(clientSecret)) throw new Error("Twitch client secret must be 1-256 safe characters");
  return clientSecret;
}
function normalizePollInterval(value) {
  if (value !== undefined && (!Number.isInteger(value) || value < minimumPollSeconds || value > maximumPollSeconds)) {
    throw new Error(`Twitch polling interval must be an integer between ${minimumPollSeconds} and ${maximumPollSeconds} seconds`);
  }
  return value === undefined ? 300 : value;
}
function normalizeTikTokHandle(value) {
  if (value !== undefined && typeof value !== "string") throw new Error("TikTok handle must be a string");
  const handle = String(value ?? "").trim().replace(/^@+/, "");
  if (!handle) return "";
  if (!/^[A-Za-z0-9._]{1,24}$/.test(handle)) throw new Error("TikTok handle must be 1-24 letters, numbers, periods, or underscores");
  return handle;
}
function normalizeTitle(value) {
  if (value !== undefined && typeof value !== "string") throw new Error("TikTok live title must be a string");
  const title = String(value ?? "").trim();
  if (title.length > 120) throw new Error("TikTok live title must be 120 characters or fewer");
  return title;
}
function requireBoolean(value, field) {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}
function cleanConfig(config) {
  return {
    twitch: {
      login: normalizeTwitchLogin(config.twitch?.login),
      enabled: Boolean(config.twitch?.enabled && config.twitch?.login),
      clientId: normalizeTwitchClientId(config.twitch?.clientId),
      clientSecret: normalizeTwitchClientSecret(config.twitch?.clientSecret),
      pollIntervalSeconds: normalizePollInterval(config.twitch?.pollIntervalSeconds)
    },
    tiktok: {
      handle: normalizeTikTokHandle(config.tiktok?.handle),
      enabled: Boolean(config.tiktok?.enabled && config.tiktok?.handle),
      live: Boolean(config.tiktok?.live && config.tiktok?.handle),
      title: normalizeTitle(config.tiktok?.title)
    }
  };
}
function publicStatus(state) {
  const config = cleanConfig(state.config);
  const status = state.status || defaultStatus;
  return {
    twitch: {
      configured: Boolean(config.twitch.enabled && config.twitch.login),
      enabled: config.twitch.enabled,
      live: Boolean(status.twitch?.live && config.twitch.enabled),
      title: status.twitch?.title || "",
      url: config.twitch.login ? `https://twitch.tv/${encodeURIComponent(config.twitch.login)}` : "",
      checkedAt: status.twitch?.checkedAt || null,
      stale: Boolean(status.twitch?.stale)
    },
    tiktok: {
      configured: Boolean(config.tiktok.enabled && config.tiktok.handle),
      enabled: config.tiktok.enabled,
      live: Boolean(status.tiktok?.live && config.tiktok.enabled),
      title: status.tiktok?.title || config.tiktok.title || "",
      url: config.tiktok.handle ? `https://www.tiktok.com/@${encodeURIComponent(config.tiktok.handle)}` : "",
      checkedAt: status.tiktok?.checkedAt || null,
      stale: false
    }
  };
}
function adminState(state) {
  const config = cleanConfig(state.config);
  return {
    config: {
      twitch: {
        login: config.twitch.login,
        enabled: config.twitch.enabled,
        clientId: config.twitch.clientId,
        clientSecretConfigured: Boolean(config.twitch.clientSecret),
        pollIntervalSeconds: config.twitch.pollIntervalSeconds
      },
      tiktok: clone(config.tiktok)
    },
    status: clone(state.status || defaultStatus)
  };
}
async function readFileState() {
  try {
    const parsed = JSON.parse(await fs.readFile(liveConfigFile, "utf8"));
    return { config: cleanConfig(parsed.config || parsed), status: { ...clone(defaultStatus), ...(parsed.status || {}) } };
  } catch {
    return clone(memoryState);
  }
}
async function writeFileState(state) {
  await fs.mkdir(path.dirname(liveConfigFile), { recursive: true });
  await fs.writeFile(liveConfigFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
async function loadState() {
  if (isDatabaseReady()) {
    const result = await query("SELECT config, status FROM live_tracking WHERE id = 1");
    if (!result.rows[0]) {
      await query("INSERT INTO live_tracking (id, config, status) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING", [defaultConfig, defaultStatus]);
      return { config: clone(defaultConfig), status: clone(defaultStatus) };
    }
    return { config: cleanConfig(result.rows[0].config || defaultConfig), status: { ...clone(defaultStatus), ...(result.rows[0].status || {}) } };
  }
  memoryState = await readFileState();
  return clone(memoryState);
}
async function saveState(state) {
  const normalized = { config: cleanConfig(state.config), status: { ...clone(defaultStatus), ...(state.status || {}) } };
  memoryState = clone(normalized);
  if (isDatabaseReady()) {
    await query("INSERT INTO live_tracking (id, config, status, updated_at) VALUES (1, $1, $2, NOW()) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, status = EXCLUDED.status, updated_at = NOW()", [normalized.config, normalized.status]);
  } else await writeFileState(normalized);
  return normalized;
}

export function validateLivePatch(body = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Request body must be an object");
  const nested = body.config && typeof body.config === "object" && !Array.isArray(body.config) ? body.config : {};
  const twitch = body.twitch && typeof body.twitch === "object" && !Array.isArray(body.twitch) ? body.twitch : nested.twitch && typeof nested.twitch === "object" && !Array.isArray(nested.twitch) ? nested.twitch : {};
  const tiktok = body.tiktok && typeof body.tiktok === "object" && !Array.isArray(body.tiktok) ? body.tiktok : nested.tiktok && typeof nested.tiktok === "object" && !Array.isArray(nested.tiktok) ? nested.tiktok : {};
  const changes = {};
  const value = (topLevel, nestedKey) => body[topLevel] !== undefined ? body[topLevel] : twitch[nestedKey];
  if (body.twitchLogin !== undefined || twitch.login !== undefined) changes.twitchLogin = normalizeTwitchLogin(value("twitchLogin", "login"));
  if (body.twitchEnabled !== undefined || twitch.enabled !== undefined) changes.twitchEnabled = requireBoolean(value("twitchEnabled", "enabled"), "twitchEnabled");
  if (body.twitchClientId !== undefined || twitch.clientId !== undefined) {
    const clientId = normalizeTwitchClientId(value("twitchClientId", "clientId"));
    if (!clientId) throw new Error("Twitch client ID is required");
    changes.twitchClientId = clientId;
  }
  if (body.twitchPollIntervalSeconds !== undefined || twitch.pollIntervalSeconds !== undefined) changes.twitchPollIntervalSeconds = normalizePollInterval(value("twitchPollIntervalSeconds", "pollIntervalSeconds"));
  const clearSecret = body.twitchClientSecretClear !== undefined ? body.twitchClientSecretClear : twitch.clientSecretClear;
  if (clearSecret !== undefined) changes.twitchClientSecretClear = requireBoolean(clearSecret, "twitchClientSecretClear");
  const clientSecret = value("twitchClientSecret", "clientSecret");
  if (clientSecret !== undefined) {
    if (changes.twitchClientSecretClear) {
      if (clientSecret !== "") throw new Error("Choose either a Twitch client secret or clear it");
    } else if (String(clientSecret).trim()) {
      changes.twitchClientSecret = normalizeTwitchClientSecret(clientSecret);
    }
  }
  if (body.tiktokHandle !== undefined || tiktok.handle !== undefined) changes.tiktokHandle = normalizeTikTokHandle(body.tiktokHandle !== undefined ? body.tiktokHandle : tiktok.handle);
  if (body.tiktokEnabled !== undefined || tiktok.enabled !== undefined) changes.tiktokEnabled = requireBoolean(body.tiktokEnabled ?? tiktok.enabled, "tiktokEnabled");
  if (body.tiktokLive !== undefined || tiktok.live !== undefined) changes.tiktokLive = requireBoolean(body.tiktokLive ?? tiktok.live, "tiktokLive");
  if (body.tiktokTitle !== undefined || tiktok.title !== undefined) changes.tiktokTitle = normalizeTitle(body.tiktokTitle !== undefined ? body.tiktokTitle : tiktok.title);
  return changes;
}
export async function getLiveState() { return adminState(await loadState()); }
export async function getPublicLive() {
  const state = await loadState();
  return publicStatus(state);
}
export async function updateLiveConfig(body) {
  const changes = validateLivePatch(body);
  const state = await loadState();
  const config = clone(state.config);
  if (changes.twitchLogin !== undefined) config.twitch.login = changes.twitchLogin;
  if (changes.twitchEnabled !== undefined) config.twitch.enabled = changes.twitchEnabled;
  if (changes.twitchClientId !== undefined) config.twitch.clientId = changes.twitchClientId;
  if (changes.twitchClientSecretClear) config.twitch.clientSecret = "";
  else if (changes.twitchClientSecret !== undefined) config.twitch.clientSecret = changes.twitchClientSecret;
  if (changes.twitchPollIntervalSeconds !== undefined) config.twitch.pollIntervalSeconds = changes.twitchPollIntervalSeconds;
  if (changes.tiktokHandle !== undefined) config.tiktok.handle = changes.tiktokHandle;
  if (changes.tiktokEnabled !== undefined) config.tiktok.enabled = changes.tiktokEnabled;
  if (changes.tiktokLive !== undefined) config.tiktok.live = changes.tiktokLive;
  if (changes.tiktokTitle !== undefined) config.tiktok.title = changes.tiktokTitle;
  const status = { ...clone(state.status), tiktok: { ...state.status.tiktok, live: config.tiktok.live, title: config.tiktok.title, checkedAt: new Date().toISOString(), stale: false } };
  const saved = await saveState({ config, status });
  return adminState(saved);
}

async function twitchRequest(pathname, options = {}) {
  const response = await fetch(pathname, options);
  if (!response.ok) throw new Error(`Twitch API returned ${response.status}`);
  return response.json();
}
async function fetchTwitchStatus(login, twitchConfig) {
  const clientId = twitchConfig.clientId;
  const clientSecret = twitchConfig.clientSecret;
  if (!clientId || !clientSecret) throw new Error("Twitch credentials are not configured");
  const tokenUrl = "https://id.twitch.tv/oauth2/token";
  const token = await twitchRequest(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" })
  });
  const result = await twitchRequest(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${token.access_token}` }
  });
  const stream = result.data?.[0];
  return stream ? { live: true, title: String(stream.title || ""), game: String(stream.game_name || "") } : { live: false, title: "", game: "" };
}
export async function checkTwitchStatus({ force = false } = {}) {
  if (pollInProgress) return getLiveState();
  const state = await loadState();
  const twitch = state.config.twitch;
  if (!twitch.enabled || !twitch.login) {
    state.status.twitch = { ...clone(defaultStatus.twitch), checkedAt: new Date().toISOString(), stale: false };
    return saveState(state);
  }
  const checkedAt = state.status.twitch?.checkedAt ? Date.parse(state.status.twitch.checkedAt) : 0;
  const pollIntervalMs = twitch.pollIntervalSeconds * 1000;
  if (!force && checkedAt && Date.now() - checkedAt < pollIntervalMs) return state;
  pollInProgress = true;
  try {
    const result = await fetchTwitchStatus(twitch.login, twitch);
    state.status.twitch = { ...state.status.twitch, ...result, checkedAt: new Date().toISOString(), stale: false, error: "" };
    return await saveState(state);
  } catch (error) {
    const unavailable = error.message === "Twitch credentials are not configured";
    state.status.twitch = {
      ...state.status.twitch,
      ...(unavailable ? { live: false, title: "" } : {}),
      checkedAt: new Date().toISOString(),
      stale: true,
      error: error.message
    };
    return await saveState(state);
  } finally { pollInProgress = false; }
}
export function startLiveTracking() {
  if (pollTimer) return;
  checkTwitchStatus().catch(error => console.error("Live tracking check failed:", error.message));
  pollTimer = setInterval(() => checkTwitchStatus().catch(error => console.error("Live tracking check failed:", error.message)), minimumPollMs);
  pollTimer.unref?.();
}
export function stopLiveTracking() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
export { publicStatus, liveConfigFile };
