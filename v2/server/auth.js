import crypto from "node:crypto";
import { isDatabaseReady, query } from "./db.js";

const oauthStateCookie = "sxber_discord_oauth_state";
const sessionCookie = "sxber_admin_session";
const oauthStateTtlSeconds = 10 * 60;
const defaultSessionTtlSeconds = 12 * 60 * 60;
const memorySessions = new Map();
const memoryActivity = [];

function sessionTtlSeconds() {
  const configured = Number(process.env.ADMIN_SESSION_TTL_SECONDS);
  if (!Number.isFinite(configured)) return defaultSessionTtlSeconds;
  return Math.min(7 * 24 * 60 * 60, Math.max(5 * 60, Math.floor(configured)));
}

function secureCookiesEnabled() {
  return process.env.AUTH_COOKIE_SECURE === "true";
}

function parseCookies(header = "") {
  return header.split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return cookies;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) return cookies;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
    return cookies;
  }, {});
}

function getCookie(request, name) {
  return parseCookies(request.get("cookie") || "")[name] || "";
}

function serializeCookie(name, value, maxAge) {
  const attributes = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`
  ];
  if (secureCookiesEnabled()) attributes.push("Secure");
  return `${name}=${encodeURIComponent(value)}; ${attributes.join("; ")}`;
}

function setCookie(response, name, value, maxAge) {
  response.append("Set-Cookie", serializeCookie(name, value, maxAge));
}

function clearCookie(response, name) {
  setCookie(response, name, "", 0);
}

function hashSession(sessionToken) {
  return crypto.createHash("sha256").update(sessionToken).digest("hex");
}

function valuesMatch(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function discordClientId() {
  return String(process.env.DISCORD_APPLICATION_ID || "").trim();
}

function discordClientSecret() {
  return String(process.env.DISCORD_CLIENT_SECRET || "").trim();
}

function redirectUri(request) {
  const configured = String(process.env.DISCORD_OAUTH_REDIRECT_URI || "").trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("DISCORD_OAUTH_REDIRECT_URI is not configured");
  return `${request.protocol}://${request.get("host")}/api/auth/discord/callback`;
}

export function isDiscordOAuthConfigured() {
  return Boolean(discordClientId() && discordClientSecret());
}

function allowedDiscordUser(userId) {
  const allowed = new Set(
    String(process.env.DISCORD_ALLOWED_USER_IDS || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  );
  return allowed.has(String(userId));
}

function normalizeDiscordUser(user) {
  const id = String(user.id);
  const username = String(user.username || `Discord user ${id}`);
  const displayName = String(user.global_name || username);
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${id}/${user.avatar}.${String(user.avatar).startsWith("a_") ? "gif" : "png"}?size=128`
    : null;
  return { id, username, displayName, avatarUrl };
}

function activityActor(actor) {
  const source = actor || {};
  return {
    id: String(source.id || source.discordUserId || "system"),
    username: String(source.username || source.discordUsername || "System"),
    displayName: String(source.displayName || source.discordDisplayName || source.username || source.discordUsername || "System"),
    avatarUrl: source.avatarUrl || null
  };
}

function formatSession(row) {
  return {
    id: String(row.discord_user_id),
    username: row.discord_username,
    displayName: row.discord_display_name || row.discord_username,
    avatarUrl: row.avatar_url || null
  };
}

function formatActivity(row) {
  return {
    id: String(row.id),
    discordUserId: row.discord_user_id,
    discordUsername: row.discord_username,
    action: row.action,
    resourceType: row.resource_type || null,
    resourceId: row.resource_id || null,
    metadata: row.metadata || {},
    ipAddress: row.ip_address || null,
    userAgent: row.user_agent || null,
    createdAt: row.created_at
  };
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id || user.discordUserId,
    username: user.username || user.discordUsername,
    displayName: user.displayName || user.discordDisplayName || user.username || user.discordUsername,
    avatarUrl: user.avatarUrl || null
  };
}

export function internalActorFromRequest(request) {
  const id = String(request.get("x-discord-user-id") || "").trim();
  const username = String(request.get("x-discord-username") || "").trim();
  return activityActor({
    id: id || "discord-bot",
    username: username || "Discord bot",
    displayName: username || "Discord bot"
  });
}

export function startDiscordLogin(request, response) {
  if (!isDiscordOAuthConfigured()) throw new Error("Discord OAuth is not configured");
  const callbackUri = redirectUri(request);
  const state = crypto.randomBytes(32).toString("base64url");
  setCookie(response, oauthStateCookie, state, oauthStateTtlSeconds);
  const params = new URLSearchParams({
    client_id: discordClientId(),
    redirect_uri: callbackUri,
    response_type: "code",
    scope: "identify",
    state
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCode(code, request) {
  const body = new URLSearchParams({
    client_id: discordClientId(),
    client_secret: discordClientSecret(),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(request)
  });
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!tokenResponse.ok) throw new Error(`Discord token exchange failed (${tokenResponse.status})`);
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) throw new Error("Discord did not return an access token");

  const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  if (!userResponse.ok) throw new Error(`Discord profile request failed (${userResponse.status})`);
  return normalizeDiscordUser(await userResponse.json());
}

export async function completeDiscordLogin(request, response) {
  const state = String(request.query.state || "");
  const storedState = getCookie(request, oauthStateCookie);
  clearCookie(response, oauthStateCookie);
  if (!valuesMatch(state, storedState)) throw new Error("Invalid Discord OAuth state");
  if (request.query.error) throw new Error("Discord login was cancelled");
  const code = String(request.query.code || "");
  if (!code) throw new Error("Discord did not return an authorization code");

  const user = await exchangeCode(code, request);
  if (!allowedDiscordUser(user.id)) {
    await recordAdminActivity(request, {
      actor: user,
      action: "auth.login.denied",
      metadata: { reason: "discord_user_not_allowlisted" }
    });
    return { allowed: false, user };
  }

  const sessionToken = crypto.randomBytes(32).toString("base64url");
  const sessionHash = hashSession(sessionToken);
  const expiresAt = new Date(Date.now() + sessionTtlSeconds() * 1000);
  const session = {
    ...user,
    sessionHash,
    expiresAt: expiresAt.toISOString()
  };
  if (isDatabaseReady()) {
    await query(
      `INSERT INTO admin_sessions
       (session_hash, discord_user_id, discord_username, discord_display_name, avatar_url, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sessionHash, user.id, user.username, user.displayName, user.avatarUrl, expiresAt, request.ip, String(request.get("user-agent") || "").slice(0, 512)]
    );
  } else {
    memorySessions.set(sessionHash, session);
  }
  setCookie(response, sessionCookie, sessionToken, sessionTtlSeconds());
  await recordAdminActivity(request, { actor: user, action: "auth.login.success" });
  return { allowed: true, user };
}

export async function getAdminSession(request) {
  const sessionToken = getCookie(request, sessionCookie);
  if (!sessionToken) return null;
  const sessionHash = hashSession(sessionToken);
  if (isDatabaseReady()) {
    const result = await query(
      `SELECT discord_user_id, discord_username, discord_display_name, avatar_url
       FROM admin_sessions
       WHERE session_hash = $1 AND expires_at > NOW()`,
      [sessionHash]
    );
    if (!result.rows[0]) return null;
    await query("UPDATE admin_sessions SET last_seen_at = NOW() WHERE session_hash = $1", [sessionHash]);
    return formatSession(result.rows[0]);
  }

  const session = memorySessions.get(sessionHash);
  if (!session || Date.parse(session.expiresAt) <= Date.now()) {
    memorySessions.delete(sessionHash);
    return null;
  }
  return publicUser(session);
}

export async function destroyAdminSession(request, response) {
  const sessionToken = getCookie(request, sessionCookie);
  clearCookie(response, sessionCookie);
  if (sessionToken) {
    const sessionHash = hashSession(sessionToken);
    memorySessions.delete(sessionHash);
    if (isDatabaseReady()) await query("DELETE FROM admin_sessions WHERE session_hash = $1", [sessionHash]);
  }
}

export async function recordAdminActivity(request, { actor, action, resourceType = null, resourceId = null, metadata = {} } = {}) {
  const user = activityActor(actor || request.adminUser);
  const entry = {
    discordUserId: user.id,
    discordUsername: user.username,
    action: String(action || "unknown"),
    resourceType,
    resourceId,
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    ipAddress: String(request.ip || "").slice(0, 128) || null,
    userAgent: String(request.get("user-agent") || "").slice(0, 512) || null,
    createdAt: new Date().toISOString()
  };

  if (isDatabaseReady()) {
    try {
      const result = await query(
        `INSERT INTO admin_activity
         (discord_user_id, discord_username, action, resource_type, resource_id, metadata, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [entry.discordUserId, entry.discordUsername, entry.action, entry.resourceType, entry.resourceId, entry.metadata, entry.ipAddress, entry.userAgent]
      );
      entry.id = String(result.rows[0].id);
      entry.createdAt = result.rows[0].created_at;
      return entry;
    } catch (error) {
      console.error("Activity ledger write failed:", error.message);
    }
  }

  entry.id = `memory-${Date.now()}-${memoryActivity.length}`;
  memoryActivity.unshift(entry);
  memoryActivity.splice(500);
  return entry;
}

export async function listAdminActivity(limit = 100) {
  const safeLimit = Math.min(200, Math.max(1, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 100));
  if (isDatabaseReady()) {
    const result = await query(
      `SELECT id, discord_user_id, discord_username, action, resource_type, resource_id, metadata, ip_address, user_agent, created_at
       FROM admin_activity
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      [safeLimit]
    );
    return result.rows.map(formatActivity);
  }
  return memoryActivity.slice(0, safeLimit);
}

export async function logLogout(request, actor) {
  return recordAdminActivity(request, { actor, action: "auth.logout" });
}
