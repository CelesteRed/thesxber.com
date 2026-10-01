import { useCallback, useEffect, useRef, useState } from "react";
import { advancePet, careForPet, createPet, claimPetScare, finishPetScare, getScareToken, loadPet, normalizePet, savePet, applyPetEvent, getPetPresence, takeDeathComment, UNLOCK_CLICKS, SXBERTY_STORAGE_KEY } from "./verity-pet.js";
import { DEFAULT_SXBERTY_SETTINGS, SXBERTY_PHASES, getSxbertyPhase, normalizeSxbertySettings } from "../shared/sxberty.js";
import { normalizePublicFood } from "../shared/sxberty-foods.js";
import { normalizePublicVoice } from "../shared/sxberty-voices.js";
import { createSxbertyVoicePlayer } from "./sxberty-voice-player.js";
import { readLatestPet, withPetLock } from "./sxberty-storage.js";
import SxbertySprite from "./SxbertySprite";
import SxbertyDoomScene from "./SxbertyDoomScene";
import SxbertyPlayground from "./SxbertyPlayground";
import SxbertyConsole from "./SxbertyConsole";
import SxbertyEscalation from "./SxbertyEscalation";
import { chooseReturnLine } from "./sxberty-return-lines.js";
import monsterImage from "./assets/verity/monster.webp";
import "./sxberty-pet.css";

// Face/monster source: https://verityminecraft.fandom.com/wiki/Verity%E2%84%A2
// The base artwork is supplied by Sxber. Source names are not displayed to visitors.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const phaseLabel = (phase) => SXBERTY_PHASES.find(item => item.id === phase)?.label || "Happy";
const happinessValue = (pet) => Math.ceil(pet.happiness);

function browserStorage() {
  try { return window.localStorage; } catch { return null; }
}

export function useSxbertyPet({ blocked = false } = {}) {
  const [pet, setPet] = useState(() => loadPet(browserStorage()));
  const [open, setOpen] = useState(false);
  const [scare, setScare] = useState(null);
  const [now, setNow] = useState(Date.now);
  const [saved, setSaved] = useState(true);
  const [speech, setSpeech] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SXBERTY_SETTINGS);
  const [foods, setFoods] = useState([]);
  const foodsRef = useRef([]);
  const [voices, setVoices] = useState([]);
  const voicesRef = useRef([]);
  const voicePlayer = useRef(null);
  const voiceRequest = useRef(0);
  const voiceEvent = useRef(0);
  const voiceIndexes = useRef({});
  const activeVoice = useRef(null);
  const pendingVoice = useRef(null);
  const previousReturnLines = useRef({});
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const [voiceStatus, setVoiceStatus] = useState({ enabled: false, playing: false, blocked: false });
  const speechBlocked = useRef(blocked);
  speechBlocked.current = blocked;
  const clicks = useRef(0);
  const trigger = useRef(null);
  const currentPet = useRef(pet);
  const escalationOrigin = useRef(null);
  const entered = useRef(false);
  const mounted = useRef(true);
  const localOnly = useRef(false);
  const lastPhase = useRef(null);
  const phraseIndexes = useRef({});
  const adopted = Boolean(pet);
  const presence = getPetPresence(pet, now);
  const canPlayVoice = useCallback(() => {
    const current = currentPet.current;
    return Boolean(current && !document.hidden && !speechBlocked.current && !current.hidden && !current.sleeping
      && !["scaring", "recovering"].includes(current.stage) && getPetPresence(current).state !== "absent");
  }, []);
  const stopVoice = useCallback(() => {
    voiceRequest.current++;
    pendingVoice.current = null;
    activeVoice.current = null;
    voicePlayer.current?.stop();
  }, []);
  const playSpeech = useCallback(async event => {
    const player = voicePlayer.current;
    const sequence = ++voiceRequest.current;
    const clips = voicesRef.current.filter(clip => clip.trigger === event?.voiceTrigger);
    if (!player?.isEnabled() || !event?.voiceTrigger || !canPlayVoice() || !clips.length) {
      activeVoice.current = null;
      pendingVoice.current = null;
      player?.stop();
      return false;
    }
    const index = voiceIndexes.current[event.voiceTrigger] || 0;
    const clip = clips[index % clips.length];
    voiceIndexes.current[event.voiceTrigger] = index + 1;
    pendingVoice.current = { id: clip.id, sequence };
    try {
      const started = await player.play({ url: `${API_BASE}${clip.url}`, durationMs: clip.durationMs });
      if (started && mounted.current && sequence === voiceRequest.current && canPlayVoice()) {
        activeVoice.current = clip.id;
        setSpeech(current => current?.id === event.id
          ? { ...current, text: clip.caption || current.text, voiceDurationMs: clip.durationMs } : current);
      }
      return started;
    } catch { return false; }
    finally {
      if (pendingVoice.current?.sequence === sequence) pendingVoice.current = null;
    }
  }, [canPlayVoice]);
  const speak = useCallback((text, announce = true, reason = null, voiceTrigger = null) => {
    const event = { id: ++voiceEvent.current, text, announce, reason, voiceTrigger: voiceTrigger || (reason ? `return-${reason}` : null) };
    speechRef.current = event;
    setSpeech(event);
    void playSpeech(event);
  }, [playSpeech]);
  useEffect(() => {
    const player = createSxbertyVoicePlayer({
      onStatus: status => {
        if (!status.playing) activeVoice.current = null;
        if (mounted.current) setVoiceStatus(status);
      },
    });
    voicePlayer.current = player;
    const visibility = () => { if (document.hidden) stopVoice(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      voiceRequest.current++;
      pendingVoice.current = null;
      activeVoice.current = null;
      document.removeEventListener("visibilitychange", visibility);
      player.destroy();
      if (voicePlayer.current === player) voicePlayer.current = null;
    };
  }, [stopVoice]);
  useEffect(() => {
    if (!canPlayVoice()) stopVoice();
  }, [blocked, pet?.hidden, pet?.sleeping, pet?.stage, presence.state, canPlayVoice, stopVoice]);
  const toggleVoice = useCallback(async () => {
    const player = voicePlayer.current;
    if (!player) return;
    if (player.isEnabled()) { stopVoice(); player.disable(); return; }
    // enable() begins its silent unlock synchronously inside this click.
    if (await player.enable() && mounted.current && voicePlayer.current === player) {
      await playSpeech(speechRef.current);
    }
  }, [playSpeech, stopVoice]);
  const commit = useCallback((next, persist = true) => {
    if (next?.stage === "countdown" && currentPet.current?.stage !== "countdown") {
      const rect = document.querySelector(".sxberty-world-pet")?.getBoundingClientRect();
      escalationOrigin.current = rect?.width ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    }
    currentPet.current = next;
    setPet(next);
    if (persist && next) {
      const stored = savePet(browserStorage(), next);
      localOnly.current = !stored;
      setSaved(stored);
    } else if (!persist) {
      localOnly.current = false;
    }
  }, []);
  const latestPet = useCallback(() => readLatestPet(browserStorage(), currentPet.current, localOnly.current), []);
  const settle = useCallback((candidate, time) => {
    // Check inside the lock: the tab may have become hidden while queued.
    // Background hydration can catch up time, but cannot steal the scare.
    const result = document.hidden || speechBlocked.current
      ? { pet: advancePet(candidate, time), scare: false }
      : claimPetScare(candidate, time);
    const canSpeak = !document.hidden && !speechBlocked.current && !result.pet?.hidden && !result.scare;
    const returnComment = canSpeak ? takeDeathComment(result.pet, time) : { pet: result.pet, reason: null };
    result.pet = returnComment.pet;
    commit(result.pet);
    setNow(time);
    if (result.scare) {
      setOpen(false);
      setSpeech(null);
      stopVoice();
      setScare(getScareToken(result.pet));
    } else {
      setScare(current => current && current !== getScareToken(result.pet) ? null : current);
      if (returnComment.reason) {
        const reason = returnComment.reason;
        const line = chooseReturnLine(reason, { previous: previousReturnLines.current[reason] });
        previousReturnLines.current[reason] = line;
        speak(line, true, reason);
      }
    }
    return result.pet;
  }, [commit, speak, stopVoice]);
  const update = useCallback((action) => withPetLock(() => {
    if (!mounted.current) return null;
    const time = Date.now();
    const latest = latestPet();
    return settle(action ? careForPet(latest, action, time) : latest, time);
  }), [latestPet, settle]);
  useEffect(() => {
    if (adopted && !blocked && !document.hidden) update();
  }, [adopted, blocked, update]);
  const onEvent = useCallback((event) => withPetLock(() => {
    if (!mounted.current || !event || typeof event !== "object") return false;
    const food = event.type === "food" ? foodsRef.current.find(item => item.id === event.foodId) : null;
    if (event.type === "food" && !food) return false;
    const packet = { id: event.id, token: event.token, type: event.type };
    if (food) packet.stats = { fullness: food.fullness, happiness: food.happiness, energy: food.energy };
    const time = Date.now();
    const outcome = applyPetEvent(latestPet(), packet, time);
    const next = settle(outcome.pet, time);
    const announcedReturn = outcome.pet?.lastDeath && !outcome.pet.lastDeath.announced
      && next?.lastDeath?.id === outcome.pet.lastDeath.id && next.lastDeath.announced;
    if (outcome.accepted && !announcedReturn) {
      if (food) speak(`Sxberty ate ${food.name}.`, true, null, "food");
      else if (event.type === "throw") speak("Sxberty isn't a bowling ball.", true, null, "throw");
      else { setOpen(false); setSpeech(null); stopVoice(); }
    }
    return outcome.accepted;
  }), [latestPet, settle, speak, stopVoice]);

  useEffect(() => {
    mounted.current = true;
    if (!entered.current) { entered.current = true; update(); }
    const sync = (event) => {
      if (event.key !== SXBERTY_STORAGE_KEY && event.key !== null) return;
      try {
        const next = normalizePet(JSON.parse(browserStorage()?.getItem(SXBERTY_STORAGE_KEY) || "null"));
        commit(next, false);
        if (!next || next.hidden || !["alive", "countdown"].includes(next.stage)) setOpen(false);
        setNow(Date.now());
        if (!next) { clicks.current = 0; setSpeech(null); }
      } catch { /* Ignore unavailable storage without losing in-memory care. */ }
    };
    const returnFromCache = (event) => { if (event.persisted) update(); };
    window.addEventListener("storage", sync);
    window.addEventListener("pageshow", returnFromCache);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", sync);
      window.removeEventListener("pageshow", returnFromCache);
    };
  }, [commit, update]);

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        await Promise.all([
          fetch(`${API_BASE}/api/sxberty`, { signal: controller.signal })
            .then(response => response.ok ? response.json() : null)
            .then(data => { if (data && !controller.signal.aborted) setSettings(normalizeSxbertySettings(data.settings)); })
            .catch(() => {}),
          fetch(`${API_BASE}/api/sxberty-foods`, { signal: controller.signal })
            .then(response => response.ok ? response.json() : null)
            .then(data => {
              if (!Array.isArray(data?.items) || controller.signal.aborted) return;
              const items = data.items.map(normalizePublicFood).filter(Boolean);
              foodsRef.current = items;
              setFoods(items);
            }).catch(() => {}),
          fetch(`${API_BASE}/api/sxberty-voices`, { signal: controller.signal })
            .then(response => response.ok ? response.json() : null)
            .then(data => {
              if (!Array.isArray(data?.items) || controller.signal.aborted) return;
              const items = data.items.map(normalizePublicVoice).filter(Boolean);
              voicesRef.current = items;
              setVoices(items);
              if ([activeVoice.current, pendingVoice.current?.id].some(id => id && !items.some(item => item.id === id))) stopVoice();
            }).catch(() => {}),
        ]);
      } catch { /* Built-in phrases and the last valid food catalog remain usable. */ }
      finally { pending = false; }
    };
    load();
    const timer = adopted ? setInterval(load, 60_000) : null;
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [adopted, stopVoice]);

  useEffect(() => {
    if (!speech) return;
    const duration = Math.max(speech.reason ? 8000 : 6500, Math.min(31_000, (speech.voiceDurationMs || 0) + 300));
    const timer = setTimeout(() => setSpeech(null), duration);
    return () => clearTimeout(timer);
  }, [speech]);
  useEffect(() => {
    if (!adopted) return;
    const tick = () => { if (!document.hidden) update(); };
    // Deadlines, not interval counts: a reload, sleeping pet, paused motion or
    // backgrounded tab cannot restart or freeze the corruption countdown.
    const timer = setInterval(tick, pet?.stage === "alive" && presence.state === "present" ? 5000 : 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [adopted, pet?.stage, presence.state, update]);

  const sayPhase = useCallback((value = currentPet.current, announce = true) => {
    if (!value) return;
    const phase = getSxbertyPhase(value.happiness);
    const phrases = settings.phrases[phase]?.length ? settings.phrases[phase] : DEFAULT_SXBERTY_SETTINGS.phrases[phase];
    const index = phraseIndexes.current[phase] || 0;
    phraseIndexes.current[phase] = index + 1;
    lastPhase.current = phase;
    speak(phrases[index % phrases.length], announce, null, phase);
  }, [settings, speak]);
  useEffect(() => {
    lastPhase.current = null;
    phraseIndexes.current = {};
  }, [pet?.generation]);
  const phase = pet ? getSxbertyPhase(pet.happiness) : null;
  useEffect(() => {
    if (!phase) { lastPhase.current = null; return; }
    if (scare || speech?.reason || presence.state !== "present" || ["scaring", "recovering", "forming"].includes(pet?.stage) || lastPhase.current === phase) return;
    const firstGreeting = lastPhase.current === null;
    lastPhase.current = phase;
    sayPhase(currentPet.current, firstGreeting);
  }, [phase, pet?.stage, presence.state, speech?.reason, scare, sayPhase]);

  const visit = async (event) => {
    trigger.current = event.currentTarget;
    if (currentPet.current) {
      const next = await update("show");
      if (next && mounted.current && next.stage !== "scaring") setOpen(true);
    } else if (++clicks.current >= UNLOCK_CLICKS) {
      await withPetLock(() => {
        if (mounted.current) commit(latestPet() || createPet());
      });
    }
  };
  const care = async (action) => {
    const pendingDeath = currentPet.current?.lastDeath;
    const next = await update(action);
    if (!next || !mounted.current) return;
    if (action === "hide") { setOpen(false); setSpeech(null); return; }
    const announcedReturn = pendingDeath && !pendingDeath.announced && next.lastDeath?.id === pendingDeath.id && next.lastDeath.announced;
    if (!announcedReturn && action !== "pause" && getPetPresence(next).state === "present" && ["alive", "countdown"].includes(next.stage)) sayPhase(next);
  };
  const dismissScare = useCallback(() => withPetLock(() => {
    if (!mounted.current || !scare) return;
    const time = Date.now();
    commit(finishPetScare(latestPet(), scare, time));
    setNow(time);
    setScare(null);
    setOpen(false);
    setSpeech(null);
  }), [scare, commit, latestPet]);
  useEffect(() => {
    if (scare && getScareToken(pet) !== scare) setScare(null);
  }, [pet, scare]);
  return { pet, now, foods, onEvent, open, setOpen, saved, speech, sayPhase, visit, care, trigger, scare, dismissScare,
    voiceStatus, toggleVoice, voiceCount: voices.length, escalationOrigin: escalationOrigin.current };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return reduced;
}


function VoiceToggle({ status, onToggle, count, compact = false }) {
  const label = status.enabled ? "Mute Sxberty voice lines" : "Enable Sxberty voice lines";
  return <button type="button" className={compact ? "sxberty-voice-toggle" : "sxberty-voice-button"}
    onClick={onToggle} aria-label={label} title={label} aria-pressed={status.enabled} data-playing={status.playing}
    disabled={!count && !status.enabled}>
    <i className={`fa-solid ${status.enabled ? "fa-volume-high" : "fa-volume-xmark"}`} aria-hidden="true" />
    {!compact && (status.enabled ? " Mute voice" : " Enable voice")}
  </button>;
}

function HappinessHud({ pet, onOpen, blocked, voiceStatus, toggleVoice, voiceCount }) {
  const phase = getSxbertyPhase(pet.happiness);
  return <aside className="sxberty-hud" hidden={blocked} aria-label="Sxberty happiness" data-phase={phase}>
    <button type="button" onClick={onOpen} aria-haspopup="dialog" title={`Sxberty happiness — ${phaseLabel(phase)}`}
      aria-label={`Care for Sxberty. Happiness ${happinessValue(pet)} out of 100. ${phaseLabel(phase)}.`}>
      <span className="sxberty-happiness-bar" role="meter" aria-label="Sxberty happiness"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pet.happiness}
        aria-valuetext={`${happinessValue(pet)}% happiness — ${phaseLabel(phase)}`}>
        <span className="sxberty-happiness-fill" aria-hidden="true" style={{ height: `${pet.happiness}%`, opacity: pet.happiness > 0 ? 1 : 0 }} />
      </span>
      <strong className="sxberty-hud-value" aria-hidden="true">{happinessValue(pet)}%</strong>
    </button>
    {voiceCount > 0 && <VoiceToggle status={voiceStatus} onToggle={toggleVoice} count={voiceCount} compact />}
  </aside>;
}


function MonsterScare({ onClose, reduced }) {
  const dialogRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    const returnTo = document.activeElement;
    dialog.showModal();
    dialog.querySelector("button").focus();
    const fallback = setTimeout(onClose, 6000);
    return () => {
      clearTimeout(fallback);
      dialog.close();
      const target = returnTo instanceof HTMLElement && returnTo.isConnected && returnTo !== document.body && !returnTo.closest("[hidden]") ? returnTo : document.querySelector(".top-domain");
      target?.focus({ preventScroll: true });
    };
  }, [onClose]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(onClose, 2400);
    return () => clearTimeout(timer);
  }, [ready, onClose]);
  return <dialog ref={dialogRef} className={`sxberty-scare${ready ? " is-ready" : ""}${reduced ? " is-still" : ""}`} aria-label="Sxberty monster scare"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <button type="button" onClick={onClose}>Dismiss scare</button>
    {failed ? <SxbertySprite happiness={0} size={280} /> : <img src={monsterImage} alt="Sxberty’s monster form" onLoad={() => setReady(true)} onError={() => { setFailed(true); setReady(true); }} />}
    <p>Sxberty remembers.</p>
  </dialog>;
}


export default function SxbertyPet({ pet, now, foods, onEvent, open, setOpen, saved, speech, sayPhase, care, trigger, scare, dismissScare, voiceStatus, toggleVoice, voiceCount, escalationOrigin, blocked = false }) {
  const reduced = useReducedMotion();
  const presence = getPetPresence(pet, now);
  const growing = pet?.stage === "countdown";
  const available = pet && !["countdown", "scaring"].includes(pet.stage);
  const roaming = pet && pet.stage === "alive" && presence.state === "present" && !pet.hidden && !pet.sleeping && !pet.paused && !open && !blocked && !scare;
  useEffect(() => {
    if (!roaming) return;
    const timer = setInterval(() => { if (!document.hidden) sayPhase(undefined, false); }, 35_000);
    return () => clearInterval(timer);
  }, [roaming, sayPhase]);
  if (!pet) return null;
  const onOpen = event => { trigger.current = event.currentTarget; setOpen(true); };
  return <>
    <SxbertyDoomScene pet={pet} now={now} />
    {!pet.hidden && <HappinessHud pet={pet} onOpen={onOpen} blocked={blocked || Boolean(scare)} voiceStatus={voiceStatus} toggleVoice={toggleVoice} voiceCount={voiceCount} />}
    <SxbertyPlayground key={pet.generation} pet={pet} foods={foods} apiBase={API_BASE} speech={speech}
      onOpen={onOpen} onEvent={onEvent} blocked={blocked || growing || pet.hidden || Boolean(scare)} reduced={reduced} />
    <SxbertyConsole pet={pet} now={now} isOpen={Boolean(available && open && !blocked && !scare && !pet.hidden)}
      speech={speech} saved={saved} care={care} sayPhase={sayPhase} reduced={reduced} trigger={trigger} onClose={() => setOpen(false)}
      voiceStatus={voiceStatus} voiceControl={<VoiceToggle status={voiceStatus} onToggle={toggleVoice} count={voiceCount} />} />
    {growing && !blocked && <SxbertyEscalation pet={pet} now={now} origin={escalationOrigin} reduced={reduced} />}
    {scare && <MonsterScare key={scare} onClose={dismissScare} reduced={reduced} />}
  </>;
}
