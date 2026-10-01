const MAX_DURATION_MS = 30_000;
const UNLOCK_TIMEOUT_MS = 1000;
// Ten milliseconds of mono, unsigned 8-bit PCM silence. Only the internal unlock
// operation may use a data URL; uploaded clips must use HTTP(S) or relative URLs.
const UNLOCK_URL = "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

function playbackUrl(clip) {
  const value = clip?.audioUrl ?? clip?.url;
  if (typeof value !== "string" || !value || value !== value.trim()) return null;
  if (/[\u0000-\u0020\u007f\\]/.test(value) || value.startsWith("//")) return null;
  try {
    const parsed = new URL(value, "https://sxberty.invalid/");
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Status snapshots are { enabled, playing, blocked }. `playing` means the
 * current clip's play() succeeded; unlock audio never counts as playing.
 * `blocked` means an audio startup/error/deadline failed and is cleared by a
 * successful start or disable(). A permission denial also disarms the player,
 * requiring enable() in a new user gesture. Other clip failures retain opt-in.
 * Call enable() directly from a user gesture, not from a deferred effect.
 */
export function createSxbertyVoicePlayer({
  createAudio = () => new Audio(),
  onStatus = () => {},
  now = () => Date.now(),
} = {}) {
  let audio = null;
  let enabled = false;
  let armed = false;
  let playing = false;
  let blocked = false;
  let destroyed = false;
  let sequence = 0;
  let active = null;
  let lastStatus = null;

  function publish() {
    if (destroyed) return;
    const status = { enabled, playing, blocked };
    if (lastStatus && Object.keys(status).every(key => status[key] === lastStatus[key])) return;
    lastStatus = status;
    // Consumer exceptions must not strand playback or create rejected promises.
    try { onStatus({ ...status }); } catch { /* The controller owns audio, not UI errors. */ }
  }

  function resetAudio() {
    if (!audio) return;
    try { audio.pause(); } catch { /* Already detached or unavailable. */ }
    try { audio.currentTime = 0; } catch { /* Some browsers reject seeking before metadata. */ }
  }

  function isCurrent(operation) {
    return !destroyed && active === operation && sequence === operation.sequence;
  }

  function release(operation, result = false) {
    if (!operation) return;
    clearTimeout(operation.timer);
    for (const [event, listener] of operation.listeners) audio?.removeEventListener(event, listener);
    operation.listeners = [];
    operation.settle(result);
    if (active === operation) active = null;
  }

  function cancelActive() {
    sequence++;
    release(active);
    resetAudio();
    playing = false;
  }

  function makeOperation(kind) {
    let resolve;
    let settled = false;
    const promise = new Promise(done => { resolve = done; });
    const operation = {
      kind,
      sequence,
      promise,
      timer: null,
      listeners: [],
      settle(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      },
    };
    active = operation;
    return operation;
  }

  function listen(operation, event, listener) {
    audio.addEventListener(event, listener);
    operation.listeners.push([event, listener]);
  }

  function fail(operation, error) {
    if (!isCurrent(operation)) return;
    if (operation.kind === "unlock" || error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      enabled = false;
      armed = false;
    }
    release(operation);
    resetAudio();
    playing = false;
    blocked = true;
    publish();
  }

  function deadline(operation, milliseconds, action) {
    const endsAt = now() + milliseconds;
    const check = () => {
      if (!isCurrent(operation)) return;
      const remaining = endsAt - now();
      if (remaining > 0) operation.timer = setTimeout(check, remaining);
      else action();
    };
    operation.timer = setTimeout(check, milliseconds);
  }

  function start(operation) {
    // Invoke synchronously so enable() retains the browser's user activation.
    // Even stale play promises always receive a rejection handler.
    if (!isCurrent(operation)) return;
    try {
      Promise.resolve(audio.play()).then(() => {
        if (!isCurrent(operation)) return;
        if (operation.kind === "unlock") {
          release(operation, true);
          resetAudio();
          armed = true;
          enabled = true;
        } else {
          operation.settle(true);
          playing = true;
        }
        blocked = false;
        publish();
      }, error => fail(operation, error));
    } catch (error) {
      fail(operation, error);
    }
  }

  function enable() {
    if (destroyed) return Promise.resolve(false);
    if (enabled && armed) return Promise.resolve(true);
    if (active?.kind === "unlock") return active.promise;
    cancelActive();
    const operation = makeOperation("unlock");
    try {
      if (!audio) audio = createAudio();
      audio.loop = false;
      audio.preload = "auto";
      audio.volume = 0;
      audio.src = UNLOCK_URL;
      listen(operation, "error", () => fail(operation));
      deadline(operation, UNLOCK_TIMEOUT_MS, () => fail(operation));
      start(operation);
    } catch (error) {
      fail(operation, error);
    }
    return operation.promise;
  }

  function play(clip) {
    if (destroyed || !enabled || !armed) return Promise.resolve(false);
    const url = playbackUrl(clip);
    const duration = clip?.durationMs;
    if (!url || typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_MS) {
      return Promise.resolve(false);
    }
    cancelActive();
    const operation = makeOperation("clip");
    try {
      audio.volume = 0.65;
      audio.src = url;
      listen(operation, "ended", () => {
        if (!isCurrent(operation)) return;
        release(operation);
        resetAudio();
        playing = false;
        publish();
      });
      listen(operation, "error", () => fail(operation));
      deadline(operation, Math.min(duration + 1000, 31_000), () => {
        if (!isCurrent(operation)) return;
        // A stalled play() is a failure; a playing clip simply reaches its cap.
        const hadStarted = playing;
        release(operation);
        resetAudio();
        playing = false;
        if (!hadStarted) blocked = true;
        publish();
      });
      publish();
      start(operation);
    } catch (error) {
      fail(operation, error);
    }
    return operation.promise;
  }

  function stop() {
    if (destroyed) return;
    cancelActive();
    publish();
  }

  function disable() {
    if (destroyed) return;
    cancelActive();
    enabled = false;
    armed = false;
    blocked = false;
    publish();
  }

  function destroy() {
    if (destroyed) return;
    disable();
    destroyed = true;
    // Release the media resource as well as timers/listeners without replacing
    // the audio instance during its useful lifetime.
    try { audio?.removeAttribute("src"); audio?.load(); } catch { /* Detached media. */ }
    audio = null;
  }

  publish();
  return { enable, disable, play, stop, destroy, isEnabled: () => enabled && armed && !destroyed };
}
