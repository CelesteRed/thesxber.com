import test from "node:test";
import assert from "node:assert/strict";
import { createSxbertyVoicePlayer } from "./sxberty-voice-player.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function fakeClock() {
  let time = 0;
  let nextId = 0;
  const timers = new Map();
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, delay) => {
    const id = ++nextId;
    timers.set(id, { callback, at: time + delay });
    return id;
  };
  globalThis.clearTimeout = id => { timers.delete(id); };
  return {
    now: () => time,
    timers,
    restore() {
      globalThis.setTimeout = originalSet;
      globalThis.clearTimeout = originalClear;
    },
    advance(milliseconds) {
      const end = time + milliseconds;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at;
        timers.delete(due[0]);
        due[1].callback();
      }
      time = end;
    },
  };
}

class FakeAudio {
  constructor() {
    this.src = "";
    this.volume = 1;
    this.currentTime = 0;
    this.loop = true;
    this.listeners = new Map();
    this.calls = [];
    this.plans = [];
    this.pauses = 0;
    this.loads = 0;
  }
  play() {
    this.calls.push({ src: this.src, volume: this.volume });
    const plan = this.plans.shift();
    if (plan instanceof Error) throw plan;
    return plan ?? Promise.resolve();
  }
  pause() { this.pauses++; }
  load() { this.loads++; }
  removeAttribute(name) { if (name === "src") this.src = ""; }
  addEventListener(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
  }
  removeEventListener(event, listener) { this.listeners.get(event)?.delete(listener); }
  emit(event) { for (const listener of [...(this.listeners.get(event) ?? [])]) listener(); }
  listenerCount() { return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0); }
}

function fixture(t, options = {}) {
  const clock = fakeClock();
  const audio = new FakeAudio();
  const statuses = [];
  let created = 0;
  const player = createSxbertyVoicePlayer({
    createAudio: () => { created++; return audio; },
    now: clock.now,
    onStatus: status => { statuses.push(status); options.onStatus?.(status); },
  });
  t.after(() => {
    try { player.destroy(); } finally { clock.restore(); }
  });
  return { player, audio, clock, statuses, creations: () => created, status: () => statuses.at(-1) };
}

const clip = (name = "one", durationMs = 500) => ({ url: `/api/sxberty-voices/${name}/audio`, durationMs });
const denied = () => Object.assign(new Error("Gesture required"), { name: "NotAllowedError" });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("starts disabled and only enable synchronously invokes silent playback on one reused audio", async t => {
  const f = fixture(t);
  assert.deepEqual(f.status(), { enabled: false, playing: false, blocked: false });
  assert.equal(f.creations(), 0);
  assert.equal(await f.player.play(clip()), false);
  const pending = deferred();
  f.audio.plans.push(pending.promise);
  const enabled = f.player.enable();
  assert.equal(f.audio.calls.length, 1, "user activation must not be deferred to a microtask");
  assert.match(f.audio.calls[0].src, /^data:audio\/wav;base64,/);
  const wav = Buffer.from(f.audio.calls[0].src.split(",")[1], "base64");
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  assert.equal(wav.readUInt32LE(4) + 8, wav.length);
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert.equal(wav.length - 44, 80, "unlock has only ten milliseconds of samples");
  assert.ok(wav.subarray(44).every(sample => sample === 128));
  assert.equal(f.audio.calls[0].volume, 0);
  assert.equal(f.audio.loop, false);
  assert.equal(f.player.enable(), enabled, "concurrent enable shares the unlock promise");
  assert.equal(f.player.isEnabled(), false);
  pending.resolve();
  assert.equal(await enabled, true);
  assert.deepEqual(f.status(), { enabled: true, playing: false, blocked: false });
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.audio.listenerCount(), 0);
  assert.equal(await f.player.enable(), true);
  assert.equal(f.audio.calls.length, 1);
  assert.equal(await f.player.play(clip()), true);
  assert.equal(f.creations(), 1);
  assert.deepEqual(f.audio.calls[1], { src: clip().url, volume: 0.65 });
  assert.deepEqual(f.status(), { enabled: true, playing: true, blocked: false });
});

test("unlock denial is caught, remains disabled, and can be retried by a new gesture", async t => {
  const f = fixture(t);
  f.audio.plans.push(Promise.reject(denied()));
  assert.equal(await f.player.enable(), false);
  assert.deepEqual(f.status(), { enabled: false, playing: false, blocked: true });
  assert.equal(await f.player.play(clip()), false);
  assert.equal(f.audio.listenerCount(), 0);
  assert.equal(f.clock.timers.size, 0);
  assert.equal(await f.player.enable(), true);
  assert.equal(f.creations(), 1);
  assert.deepEqual(f.status(), { enabled: true, playing: false, blocked: false });
});

test("synchronous play and audio creation errors are returned as false", async t => {
  const f = fixture(t);
  f.audio.plans.push(denied());
  assert.equal(await f.player.enable(), false);
  const unavailable = createSxbertyVoicePlayer({ createAudio: () => { throw new Error("No Audio"); } });
  assert.equal(await unavailable.enable(), false);
  assert.equal(unavailable.isEnabled(), false);
  unavailable.destroy();
});

test("disable invalidates in-flight enable and late completion cannot re-enable", async t => {
  const f = fixture(t);
  const pending = deferred();
  f.audio.plans.push(pending.promise);
  const enabling = f.player.enable();
  f.player.disable();
  assert.equal(await enabling, false);
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.audio.listenerCount(), 0);
  const count = f.statuses.length;
  pending.resolve();
  await flush();
  assert.equal(f.player.isEnabled(), false);
  assert.equal(f.statuses.length, count);
  assert.equal(await f.player.play(clip()), false);
});

test("a canceled unlock rejection cannot mark a newer successful enable blocked", async t => {
  const f = fixture(t);
  const pending = deferred();
  f.audio.plans.push(pending.promise);
  const first = f.player.enable();
  f.player.disable();
  assert.equal(await f.player.enable(), true);
  pending.reject(denied());
  assert.equal(await first, false);
  await flush();
  assert.deepEqual(f.status(), { enabled: true, playing: false, blocked: false });
});

test("unlock is bounded even when native play never settles", async t => {
  const f = fixture(t);
  f.audio.plans.push(deferred().promise);
  const enabling = f.player.enable();
  f.clock.advance(999);
  assert.equal(f.player.isEnabled(), false);
  f.clock.advance(1);
  assert.equal(await enabling, false);
  assert.deepEqual(f.status(), { enabled: false, playing: false, blocked: true });
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.audio.listenerCount(), 0);
});

test("latest play replaces pending playback immediately without a backlog", async t => {
  const f = fixture(t);
  await f.player.enable();
  const oldNative = deferred();
  f.audio.plans.push(oldNative.promise);
  const first = f.player.play(clip("first"));
  f.audio.currentTime = 0.25;
  const pauseCount = f.audio.pauses;
  const second = f.player.play(clip("second"));
  assert.equal(f.audio.pauses, pauseCount + 1);
  assert.equal(f.audio.currentTime, 0);
  assert.equal(f.audio.src, clip("second").url);
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(f.clock.timers.size, 1);
  assert.equal(f.audio.listenerCount(), 2);
  const count = f.statuses.length;
  oldNative.resolve();
  await flush();
  assert.equal(f.statuses.length, count);
  assert.equal(f.audio.calls.length, 3);
  assert.equal(f.audio.src, clip("second").url);
});

test("stale failures, timers, and media callbacks cannot stop or disarm a replacement", async t => {
  const f = fixture(t);
  await f.player.enable();
  const oldNative = deferred();
  f.audio.plans.push(oldNative.promise);
  const first = f.player.play(clip("first"));
  const staleTimer = [...f.clock.timers.values()][0].callback;
  const staleEnded = [...f.audio.listeners.get("ended")][0];
  const staleError = [...f.audio.listeners.get("error")][0];
  assert.equal(await f.player.play(clip("second")), true);
  assert.equal(await first, false);
  const pauses = f.audio.pauses;
  const statuses = f.statuses.length;
  staleTimer();
  staleEnded();
  staleError();
  oldNative.reject(denied());
  await flush();
  assert.equal(f.audio.pauses, pauses);
  assert.equal(f.statuses.length, statuses);
  assert.deepEqual(f.status(), { enabled: true, playing: true, blocked: false });
});

test("stop cancels a pending play and suppresses its late successful status", async t => {
  const f = fixture(t);
  await f.player.enable();
  const native = deferred();
  f.audio.plans.push(native.promise);
  const playback = f.player.play(clip());
  f.player.stop();
  assert.equal(await playback, false);
  const count = f.statuses.length;
  native.resolve();
  await flush();
  assert.equal(f.statuses.length, count);
  assert.deepEqual(f.status(), { enabled: true, playing: false, blocked: false });
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.audio.listenerCount(), 0);
  assert.equal(await f.player.play(clip()), true, "stop retains opt-in");
});

test("stop during unlock cancels arming, while disable also stops active audio", async t => {
  const f = fixture(t);
  const native = deferred();
  f.audio.plans.push(native.promise);
  const enabling = f.player.enable();
  f.player.stop();
  assert.equal(await enabling, false);
  native.resolve();
  await flush();
  assert.equal(f.player.isEnabled(), false);
  await f.player.enable();
  await f.player.play(clip());
  f.audio.currentTime = 0.25;
  f.player.disable();
  assert.equal(f.audio.currentTime, 0);
  assert.equal(f.player.isEnabled(), false);
  assert.deepEqual(f.status(), { enabled: false, playing: false, blocked: false });
  assert.equal(f.clock.timers.size, 0);
});

test("ended and media error release listeners and timers; errors do not queue retries", async t => {
  const f = fixture(t);
  await f.player.enable();
  await f.player.play(clip());
  f.audio.emit("ended");
  assert.deepEqual(f.status(), { enabled: true, playing: false, blocked: false });
  assert.equal(f.audio.listenerCount(), 0);
  assert.equal(f.clock.timers.size, 0);
  await f.player.play(clip());
  f.audio.emit("error");
  assert.deepEqual(f.status(), { enabled: true, playing: false, blocked: true });
  assert.equal(f.audio.listenerCount(), 0);
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.audio.calls.length, 3);
  assert.equal(await f.player.play(clip()), true);
  assert.deepEqual(f.status(), { enabled: true, playing: true, blocked: false });
});

test("clip permission denial disarms but a decoder failure retains enabled state", async t => {
  const f = fixture(t);
  await f.player.enable();
  f.audio.plans.push(Promise.reject(new Error("Invalid MP3")));
  assert.equal(await f.player.play(clip()), false);
  assert.deepEqual(f.status(), { enabled: true, playing: false, blocked: true });
  f.audio.plans.push(Promise.reject(denied()));
  assert.equal(await f.player.play(clip()), false);
  assert.deepEqual(f.status(), { enabled: false, playing: false, blocked: true });
  assert.equal(await f.player.play(clip()), false);
  assert.equal(await f.player.enable(), true);
});

test("the clip hard deadline begins before native play resolves", async t => {
  const f = fixture(t);
  await f.player.enable();
  const native = deferred();
  f.audio.plans.push(native.promise);
  const playback = f.player.play(clip("stalled", 500));
  f.clock.advance(1499);
  assert.equal(f.clock.timers.size, 1);
  f.clock.advance(1);
  assert.equal(await playback, false);
  assert.deepEqual(f.status(), { enabled: true, playing: false, blocked: true });
  const count = f.statuses.length;
  native.resolve();
  await flush();
  assert.equal(f.statuses.length, count);
  assert.equal(f.audio.listenerCount(), 0);
});

test("playing clips stop at duration plus one second, with an absolute 31-second maximum", async t => {
  const f = fixture(t);
  await f.player.enable();
  await f.player.play(clip("short", 100));
  f.clock.advance(1099);
  assert.equal(f.status().playing, true);
  f.clock.advance(1);
  assert.deepEqual(f.status(), { enabled: true, playing: false, blocked: false });
  await f.player.play(clip("long", 30_000));
  f.clock.advance(30_999);
  assert.equal(f.status().playing, true);
  f.clock.advance(1);
  assert.equal(f.status().playing, false);
  assert.equal(f.clock.timers.size, 0);
});

test("accepts resolved HTTP and safe relative URLs, with optional audioUrl override", async t => {
  const f = fixture(t);
  await f.player.enable();
  for (const url of ["/api/sxberty-voices/one/audio", "api/sxberty-voices/one/audio", "https://media.example/voice.mp3", "http://localhost:3001/api/voice"]) {
    assert.equal(await f.player.play({ url, durationMs: 100 }), true);
    assert.equal(f.audio.src, url);
  }
  assert.equal(await f.player.play({ ...clip(), audioUrl: "https://api.example/voice.mp3" }), true);
  assert.equal(f.audio.src, "https://api.example/voice.mp3");
});

test("invalid durations and unsafe URLs are rejected without replacing an active clip", async t => {
  const f = fixture(t);
  await f.player.enable();
  await f.player.play(clip());
  for (const durationMs of [0, -1, 30_001, NaN, Infinity, "100", undefined, null]) {
    assert.equal(await f.player.play({ ...clip(), durationMs }), false);
  }
  for (const url of ["javascript:alert(1)", "data:audio/mpeg;base64,AA==", "blob:https://example/x", "ftp://example/voice", "//example/voice", "https://user:secret@example/voice", "/api/voice\n", " /api/voice", "/api/a b", "/api\\voice", "http://", ""]) {
    assert.equal(await f.player.play({ url, durationMs: 100 }), false, url);
  }
  assert.equal(await f.player.play(null), false);
  assert.equal(await f.player.play({ ...clip(), audioUrl: "javascript:alert(1)" }), false);
  assert.equal(f.audio.calls.length, 2);
  assert.equal(f.audio.src, clip().url);
  assert.equal(f.status().playing, true);
});

test("destroy is idempotent, cancels pending work, releases media and suppresses late callbacks", async t => {
  const f = fixture(t);
  await f.player.enable();
  const native = deferred();
  f.audio.plans.push(native.promise);
  const playback = f.player.play(clip());
  const oldTimer = [...f.clock.timers.values()][0].callback;
  const oldError = [...f.audio.listeners.get("error")][0];
  f.player.destroy();
  assert.equal(await playback, false);
  assert.equal(f.audio.src, "");
  assert.equal(f.audio.loads, 1);
  assert.equal(f.audio.listenerCount(), 0);
  assert.equal(f.clock.timers.size, 0);
  const count = f.statuses.length;
  oldTimer();
  oldError();
  native.reject(denied());
  await flush();
  f.player.destroy();
  f.player.disable();
  f.player.stop();
  assert.equal(await f.player.enable(), false);
  assert.equal(await f.player.play(clip()), false);
  assert.equal(f.player.isEnabled(), false);
  assert.equal(f.statuses.length, count);
  assert.equal(f.audio.loads, 1);
});

test("destroy during unlock never permits late arming", async t => {
  const f = fixture(t);
  const native = deferred();
  f.audio.plans.push(native.promise);
  const enabling = f.player.enable();
  f.player.destroy();
  native.resolve();
  assert.equal(await enabling, false);
  await flush();
  assert.equal(f.player.isEnabled(), false);
  assert.equal(f.audio.listenerCount(), 0);
});

test("consumer status exceptions do not create failed playback promises", async t => {
  const f = fixture(t, { onStatus: () => { throw new Error("UI callback"); } });
  assert.equal(await f.player.enable(), true);
  assert.equal(await f.player.play(clip()), true);
  f.player.stop();
  assert.equal(f.player.isEnabled(), true);
});
