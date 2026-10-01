import { useCallback, useEffect, useRef, useState } from "react";
import { advancePet, careForPet, createPet, claimPetScare, finishPetScare, getScareToken, loadPet, normalizePet, savePet, applyPetEvent, getPetPresence, takeDeathComment, UNLOCK_CLICKS, SXBERTY_STORAGE_KEY, COUNTDOWN_MS, DEATH_DELAY_MS } from "./verity-pet.js";
import { DEFAULT_SXBERTY_SETTINGS, SXBERTY_PHASES, getSxbertyPhase, normalizeSxbertySettings } from "../shared/sxberty.js";
import { normalizePublicFood } from "../shared/sxberty-foods.js";
import { readLatestPet, withPetLock } from "./sxberty-storage.js";
import SxbertySprite from "./SxbertySprite";
import SxbertyDoomScene from "./SxbertyDoomScene";
import SxbertyPlayground from "./SxbertyPlayground";
import { getDoomPresentation } from "./sxberty-doom.js";
import monsterImage from "./assets/verity/monster.webp";
import "./sxberty-pet.css";

// Face/monster source: https://verityminecraft.fandom.com/wiki/Verity%E2%84%A2
// The base artwork is supplied by Sxber. Source names are not displayed to visitors.
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const phaseLabel = (phase) => SXBERTY_PHASES.find(item => item.id === phase)?.label || "Happy";
const happinessValue = (pet) => Math.ceil(pet.happiness);
const RETURN_LINES = {
  offscreen: "You threw Sxberty right off the page. That was not a shortcut.",
  lava: "That was lava! Sxberty lost half his happiness in that bucket.",
  monster: "Sxberty is back after the monster got him. Let's not do that again.",
};

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
  const speechBlocked = useRef(blocked);
  speechBlocked.current = blocked;
  const clicks = useRef(0);
  const trigger = useRef(null);
  const currentPet = useRef(pet);
  const entered = useRef(false);
  const mounted = useRef(true);
  const localOnly = useRef(false);
  const lastPhase = useRef(null);
  const phraseIndexes = useRef({});
  const adopted = Boolean(pet);
  const presence = getPetPresence(pet, now);
  const speak = useCallback((text, announce = true, reason = null) => setSpeech({ text, announce, reason }), []);
  const commit = useCallback((next, persist = true) => {
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
    const result = document.hidden
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
      setScare(getScareToken(result.pet));
    } else {
      setScare(current => current && current !== getScareToken(result.pet) ? null : current);
      if (returnComment.reason) speak(RETURN_LINES[returnComment.reason], true, returnComment.reason);
    }
    return result.pet;
  }, [commit, speak]);
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
      if (food) speak(`Sxberty ate ${food.name}.`);
      else if (event.type === "throw") speak("Sxberty isn't a bowling ball.");
      else { setOpen(false); setSpeech(null); }
    }
    return outcome.accepted;
  }), [latestPet, settle, speak]);

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
        ]);
      } catch { /* Built-in phrases and the last valid food catalog remain usable. */ }
      finally { pending = false; }
    };
    load();
    const timer = adopted ? setInterval(load, 60_000) : null;
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [adopted]);

  useEffect(() => {
    if (!speech) return;
    const timer = setTimeout(() => setSpeech(null), speech.reason ? 8000 : 6500);
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
    speak(phrases[index % phrases.length], announce);
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
  return { pet, now, foods, onEvent, open, setOpen, saved, speech, sayPhase, visit, care, trigger, scare, dismissScare };
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


function HappinessHud({ pet, onOpen, blocked }) {
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
  </aside>;
}

function PetDialog({ pet, now, saved, speech, onClose, care, sayPhase, reduced, trigger }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const returnTo = trigger.current;
    dialog.showModal();
    dialog.querySelector(".sxberty-close").focus();
    return () => {
      dialog.close();
      const target = returnTo instanceof HTMLElement && returnTo.isConnected && !returnTo.closest("[hidden]") ? returnTo : document.querySelector(".top-domain");
      target?.focus({ preventScroll: true });
    };
  }, []);
  const mood = phaseLabel(getSxbertyPhase(pet.happiness));
  const age = Math.max(1, Math.floor((Date.now() - pet.adoptedAt) / 86_400_000) + 1);
  const doomed = pet.stage === "countdown";
  const presence = getPetPresence(pet, now);
  const unavailable = pet.stage !== "alive" || presence.state !== "present";
  return <dialog ref={dialogRef} className="sxberty-dialog" aria-labelledby="sxberty-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sxberty-card">
      <button className="sxberty-close" type="button" aria-label="Close Sxberty care" onClick={onClose}>×</button>
      <p className="sxberty-eyebrow">Your personal helper friend</p>
      <div className="sxberty-intro">
        <SxbertySprite happiness={pet.happiness} face={presence.face} size={84} />
        <div><h2 id="sxberty-title">Sxberty</h2><p>{presence.state === "absent" ? "Returning soon" : presence.state === "falling" ? "Falling back in" : pet.sleeping ? `Sleeping · ${mood}` : mood}</p><small>Buddy {pet.generation} · Day {age} · Bond {pet.bond}</small></div>
      </div>
      <p className="sxberty-dialog-speech" role="status">{speech?.text || `Sxberty is feeling ${mood.toLowerCase()}.`}</p>
      <div className="sxberty-needs">
        {[["fullness", "Fullness"], ["happiness", "Happiness"], ["energy", "Energy"]].map(([key, label]) => <label key={key}>
          <span>{label}<strong>{key === "happiness" ? happinessValue(pet) : Math.round(pet[key])}<small> / 100</small></strong></span>
          <meter min="0" max="100" low="25" high="80" optimum="100" value={pet[key]}>{Math.round(pet[key])}%</meter>
        </label>)}
      </div>
      <div className="sxberty-care-actions">
        <button type="button" onClick={() => care("play")} disabled={unavailable || pet.sleeping || pet.energy < 12}>Play<small>{pet.energy < 12 ? "Needs a nap first" : "+18 happiness"}</small></button>
        <button type="button" onClick={() => care("pet")} disabled={unavailable || pet.sleeping}>Pet<small>+8 happiness</small></button>
        <button type="button" onClick={() => care("sleep")} disabled={unavailable}>{pet.sleeping ? "Wake up" : "Sleep"}<small>{pet.sleeping ? "Hello again" : "Recharge energy"}</small></button>
      </div>
      <div className="sxberty-options">
        <button type="button" disabled={pet.sleeping || presence.state !== "present"} onClick={() => sayPhase(pet)}>Talk to Sxberty</button>
        <button type="button" onClick={() => care("pause")} aria-pressed={pet.paused} disabled={reduced}>{pet.paused ? "Resume roaming" : "Pause roaming"}</button>
        <button type="button" onClick={() => care("hide")}>Hide pet</button>
      </div>
      <p className="sxberty-food-help">Wait for food to fall, then drag a snack onto Sxberty. Each minute has a 20% chance of a food drop. You can also focus a dropped snack and press Enter to feed him.</p>
      <p className="sxberty-note">Ordinary throws cost 1 happiness. Off-screen throws cost only 5; lava takes half his current happiness. After a death, he falls back in {DEATH_DELAY_MS / 1000} seconds.</p>
      <p className="sxberty-warning">At 0 happiness, a {COUNTDOWN_MS / 1000}-second countdown changes the page from gray to red. Then comes the monster, and a new Sxberty falls back after {DEATH_DELAY_MS / 1000} seconds.</p>
      {doomed && <p className="sxberty-warning">Time left: <output role="timer" aria-live="off">{getDoomPresentation(pet, now).time}</output>. It's too late to save this Sxberty. Hiding, pausing or refreshing will not reset the timer.</p>}
      {reduced && <p className="sxberty-note">Roaming and scare motion are off for your reduced-motion preference.</p>}
      <p className="sxberty-save-note" role="status">{saved ? "Saved in this browser. No account needed." : "Browser storage is unavailable. Progress lasts for this visit only."}</p>
      <p className="sxberty-note">Click thesxber.com to visit again. Hiding never resets his stats.</p>
    </div>
  </dialog>;
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

function ReturnNotice({ presence }) {
  const seconds = Math.ceil(presence.remainingMs / 1000);
  return <aside className="sxberty-return-notice" aria-label="Sxberty return">
    <span>Sxberty is coming back</span>
    <output role="timer" aria-live="off">{seconds > 0 ? `${seconds}s` : "Returning…"}</output>
  </aside>;
}

export default function SxbertyPet({ pet, now, foods, onEvent, open, setOpen, saved, speech, sayPhase, care, trigger, scare, dismissScare, blocked = false }) {
  const reduced = useReducedMotion();
  const presence = getPetPresence(pet, now);
  const available = pet && pet.stage !== "scaring";
  const roaming = pet && ["alive", "countdown"].includes(pet.stage) && presence.state === "present" && !pet.hidden && !pet.sleeping && !pet.paused && !open && !blocked && !scare;
  useEffect(() => {
    if (!roaming) return;
    const timer = setInterval(() => { if (!document.hidden) sayPhase(undefined, false); }, 35_000);
    return () => clearInterval(timer);
  }, [roaming, sayPhase]);
  if (!pet) return null;
  const onOpen = event => { trigger.current = event.currentTarget; setOpen(true); };
  return <>
    <SxbertyDoomScene pet={pet} now={now} obscured={blocked || open || Boolean(scare)} />
    {!pet.hidden && <HappinessHud pet={pet} onOpen={onOpen} blocked={blocked || open || Boolean(scare)} />}
    <SxbertyPlayground key={pet.generation} pet={pet} foods={foods} apiBase={API_BASE} speech={speech}
      onOpen={onOpen} onEvent={onEvent} blocked={blocked || open || pet.hidden || Boolean(scare)} reduced={reduced} />
    {available && open && !blocked && !scare && <PetDialog pet={pet} now={now} saved={saved} speech={speech} onClose={() => setOpen(false)} care={care} sayPhase={sayPhase} reduced={reduced} trigger={trigger} />}
    {!pet.hidden && presence.state === "absent" && !blocked && !open && !scare && <ReturnNotice presence={presence} />}
    {scare && <MonsterScare key={scare} onClose={dismissScare} reduced={reduced} />}
  </>;
}
