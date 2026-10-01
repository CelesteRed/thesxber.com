import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "sxber-live-test-"));
process.env.DATABASE_URL = "";
process.env.LIVE_CONFIG_FILE = path.join(scratch, "live.json");
const live = await import("./live.js");

test.after(async () => fs.rm(scratch, { recursive: true, force: true }));

test("live config validation normalizes handles and rejects unsafe values", () => {
  assert.deepEqual(live.validateLivePatch({ twitch: { login: "@The_Sxber", enabled: true, clientId: "client-id", clientSecret: "client-secret", pollIntervalSeconds: 60 }, tiktok: { handle: "@creator.name", enabled: true, live: true, title: "Now" } }), {
    twitchLogin: "the_sxber", twitchEnabled: true, twitchClientId: "client-id", twitchClientSecret: "client-secret", twitchPollIntervalSeconds: 60, tiktokHandle: "creator.name", tiktokEnabled: true, tiktokLive: true, tiktokTitle: "Now"
  });
  assert.deepEqual(live.validateLivePatch({ config: { twitch: { login: "Nested", enabled: false }, tiktok: { handle: "nested", enabled: true } } }), {
    twitchLogin: "nested", twitchEnabled: false, tiktokHandle: "nested", tiktokEnabled: true
  });
  for (const body of [{ twitchLogin: "bad login" }, { twitchClientId: "" }, { twitchClientId: "bad id!" }, { twitchClientSecret: "x".repeat(257) }, { twitchPollIntervalSeconds: 59 }, { twitchPollIntervalSeconds: 60.5 }, { tiktokHandle: "bad handle!" }, { twitchLogin: 12 }, { tiktokHandle: null }, { twitchEnabled: "true" }, { tiktokLive: 1 }, { tiktokTitle: "x".repeat(121) }]) {
    assert.throws(() => live.validateLivePatch(body));
  }
});

test("Live config persists Twitch settings while redacting the client secret", async () => {
  const result = await live.updateLiveConfig({
    twitchLogin: "streamer",
    twitchEnabled: true,
    twitchClientId: "stored-client-id",
    twitchClientSecret: "stored-client-secret",
    twitchPollIntervalSeconds: 120,
    tiktokHandle: "creator",
    tiktokEnabled: true,
    tiktokLive: true,
    tiktokTitle: "Live now"
  });
  assert.deepEqual(result.config.twitch, {
    login: "streamer", enabled: true, clientId: "stored-client-id", clientSecretConfigured: true, pollIntervalSeconds: 120
  });
  assert.equal(Object.hasOwn(result.config.twitch, "clientSecret"), false);
  const stored = JSON.parse(await fs.readFile(process.env.LIVE_CONFIG_FILE, "utf8"));
  assert.equal(stored.config.twitch.clientSecret, "stored-client-secret");
  const adminState = await live.getLiveState();
  assert.equal(Object.hasOwn(adminState.config.twitch, "clientSecret"), false);
  assert.equal(adminState.config.twitch.clientSecretConfigured, true);
  assert.doesNotMatch(JSON.stringify(adminState), /stored-client-secret/);
  const preserved = await live.updateLiveConfig({ twitchClientSecret: "" });
  assert.equal(preserved.config.twitch.clientSecretConfigured, true);
  const publicResult = await live.getPublicLive();
  assert.deepEqual(publicResult.tiktok, {
    configured: true, enabled: true, live: true, title: "Live now", url: "https://www.tiktok.com/@creator", checkedAt: publicResult.tiktok.checkedAt, stale: false
  });
  assert.equal(Object.hasOwn(publicResult, "config"), false);
  assert.equal(Object.hasOwn(publicResult.twitch, "error"), false);
});

test("Twitch Helix status uses stored credentials and marks transient failures stale", async () => {
  const calls = [];
  const previousFetch = globalThis.fetch;
  process.env.TWITCH_CLIENT_ID = "wrong-env-id";
  process.env.TWITCH_CLIENT_SECRET = "wrong-env-secret";
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) return { ok: true, json: async () => ({ access_token: "token" }) };
    if (calls.length === 2) return { ok: true, json: async () => ({ data: [{ title: "Stream title", game_name: "Game" }] }) };
    throw new Error("network down");
  };
  try {
    const liveState = await live.checkTwitchStatus({ force: true });
    assert.equal(liveState.status.twitch.live, true);
    assert.equal(calls[0].url, "https://id.twitch.tv/oauth2/token");
    assert.match(String(calls[0].options.body), /client_id=stored-client-id/);
    assert.match(String(calls[0].options.body), /client_secret=stored-client-secret/);
    assert.match(calls[1].url, /helix\/streams/);
    assert.equal(calls[1].options.headers["Client-Id"], "stored-client-id");
    assert.equal(calls[1].options.headers.Authorization, "Bearer token");
    const staleState = await live.checkTwitchStatus({ force: true });
    assert.equal(staleState.status.twitch.live, true);
    assert.equal(staleState.status.twitch.stale, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Twitch status remains unavailable when stored credentials are absent", async () => {
  await live.updateLiveConfig({ twitchClientSecretClear: true });
  const state = await live.checkTwitchStatus({ force: true });
  assert.equal(state.status.twitch.live, false);
  assert.equal(state.status.twitch.stale, true);
  const publicState = await live.getPublicLive();
  assert.equal(publicState.twitch.live, false);
  assert.equal(publicState.twitch.stale, true);
});
