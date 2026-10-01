import { useCallback, useEffect, useRef, useState } from "react";
import { advancePet, careForPet, createPet, claimPetScare, finishPetScare, getScareToken, loadPet, normalizePet, savePet, UNLOCK_CLICKS, SXBERTY_STORAGE_KEY, COUNTDOWN_MS, FORMATION_MS } from "./verity-pet.js";
import { DEFAULT_SXBERTY_SETTINGS, SXBERTY_PHASES, getSxbertyPhase, normalizeSxbertySettings } from "../shared/sxberty.js";
import { readLatestPet, withPetLock } from "./sxberty-storage.js";
import SxbertySprite from "./SxbertySprite";
import SxbertyDoomScene from "./SxbertyDoomScene";
import { getHopPose, HOP_DURATION_SECONDS } from "./sxberty-motion.js";
import { getDoomPresentation } from "./sxberty-doom.js";
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

export function useSxbertyPet() {
  const [pet, setPet] = useState(() => loadPet(browserStorage()));
  const [open, setOpen] = useState(false);
  const [scare, setScare] = useState(null);
  const [now, setNow] = useState(Date.now);
  const [saved, setSaved] = useState(true);
  const [speech, setSpeech] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SXBERTY_SETTINGS);
  const clicks = useRef(0);
  const trigger = useRef(null);
  const currentPet = useRef(pet);
  const entered = useRef(false);
  const mounted = useRef(true);
  const localOnly = useRef(false);
  const lastPhase = useRef(null);
  const phraseIndexes = useRef({});
  const adopted = Boolean(pet);
  const speak = useCallback((text, announce = true) => setSpeech({ text, announce }), []);
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
  const update = useCallback((action) => withPetLock(() => {
    if (!mounted.current) return null;
    const time = Date.now();
    const latest = latestPet();
    const candidate = action ? careForPet(latest, action, time) : latest;
    // Check inside the lock: the tab may have become hidden while queued.
    // Background hydration can catch up time, but cannot steal the scare.
    const result = document.hidden
      ? { pet: advancePet(candidate, time), scare: false }
      : claimPetScare(candidate, time);
    commit(result.pet);
    setNow(time);
    if (result.scare) {
      setOpen(false);
      setSpeech(null);
      setScare(getScareToken(result.pet));
    } else {
      setScare(current => current && current !== getScareToken(result.pet) ? null : current);
    }
    return result.pet;
  }), [commit, latestPet]);

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
        const response = await fetch(`${API_BASE}/api/sxberty`, { signal: controller.signal });
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted) setSettings(normalizeSxbertySettings(data.settings));
        }
      } catch { /* Built-in phrases remain usable when the API is offline. */ }
      finally { pending = false; }
    };
    load();
    const timer = adopted ? setInterval(load, 60_000) : null;
    document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [adopted]);

  useEffect(() => {
    if (!speech) return;
    const timer = setTimeout(() => setSpeech(null), 6500);
    return () => clearTimeout(timer);
  }, [speech]);
  useEffect(() => {
    if (!adopted) return;
    const tick = () => { if (!document.hidden) update(); };
    // Deadlines, not interval counts: a reload, sleeping pet, paused motion or
    // backgrounded tab cannot restart or freeze the corruption countdown.
    const timer = setInterval(tick, pet?.stage === "alive" ? 5000 : 1000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [adopted, pet?.stage, update]);

  const sayPhase = useCallback((value = currentPet.current, announce = true) => {
    if (!value) return;
    const phase = getSxbertyPhase(value.happiness);
    const phrases = settings.phrases[phase]?.length ? settings.phrases[phase] : DEFAULT_SXBERTY_SETTINGS.phrases[phase];
    const index = phraseIndexes.current[phase] || 0;
    phraseIndexes.current[phase] = index + 1;
    speak(phrases[index % phrases.length], announce);
  }, [settings, speak]);
  useEffect(() => {
    lastPhase.current = null;
    phraseIndexes.current = {};
    setSpeech(null);
  }, [pet?.generation]);
  const phase = pet ? getSxbertyPhase(pet.happiness) : null;
  useEffect(() => {
    if (!phase) { lastPhase.current = null; return; }
    if (scare || ["scaring", "forming"].includes(pet?.stage) || lastPhase.current === phase) return;
    const firstGreeting = lastPhase.current === null;
    lastPhase.current = phase;
    sayPhase(currentPet.current, firstGreeting);
  }, [phase, pet?.stage, scare, sayPhase]);

  const visit = async (event) => {
    trigger.current = event.currentTarget;
    if (currentPet.current) {
      const next = await update("show");
      if (next && mounted.current && ["alive", "countdown"].includes(next.stage)) setOpen(true);
    } else if (++clicks.current >= UNLOCK_CLICKS) {
      await withPetLock(() => {
        if (mounted.current) commit(latestPet() || createPet());
      });
    }
  };
  const care = async (action) => {
    const next = await update(action);
    if (!next || !mounted.current) return;
    if (action === "hide") { setOpen(false); setSpeech(null); return; }
    if (action !== "pause" && ["alive", "countdown"].includes(next.stage)) sayPhase(next);
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
  return { pet, now, open, setOpen, saved, speech, sayPhase, visit, care, trigger, scare, dismissScare };
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

function PetWalker({ pet, speech, onOpen, blocked, reduced }) {
  const walker = useRef(null);
  const sprite = useRef(null);
  const shadow = useRef(null);
  const bubble = useRef(null);
  const position = useRef({ x: 24, direction: 1, elapsed: 0, angle: 0, pose: getHopPose(0) });
  const [held, setHeld] = useState(false);
  const still = reduced || pet.paused || pet.sleeping || held || blocked;
  useEffect(() => {
    const node = walker.current;
    const image = sprite.current;
    const spot = position.current;
    if (reduced || pet.paused || pet.sleeping || blocked) {
      spot.pose = getHopPose(0);
      spot.angle = 0;
    }
    let frame = 0;
    let previous = 0;
    let maxX = 0;
    let size = 84;
    let bubbleWidth = 0;
    const paint = () => {
      const pose = spot.pose;
      node.style.transform = `translate3d(${spot.x}px, ${-pose.height}px, 0)`;
      image.style.transform = `rotate(${spot.angle}deg) scale(${pose.scaleX}, ${pose.scaleY})`;
      shadow.current.style.transform = `translateY(${pose.height}px) scale(${pose.shadowScale})`;
      shadow.current.style.opacity = String(pose.shadowOpacity);
      if (bubble.current) {
        const center = Math.max(bubbleWidth / 2 + 8, Math.min(window.innerWidth - bubbleWidth / 2 - 8, spot.x + size / 2));
        bubble.current.style.left = `${center}px`;
        // Keep the speech above the left-side happiness card, not over it.
        bubble.current.style.bottom = center - bubbleWidth / 2 < 180
          ? "calc(var(--sxberty-bubble-left-bottom, 276px) + env(safe-area-inset-bottom))"
          : "max(136px, calc(env(safe-area-inset-bottom) + 122px))";
      }
    };
    const resize = () => {
      size = node.offsetWidth || 84;
      bubbleWidth = bubble.current?.offsetWidth || 0;
      maxX = Math.max(8, window.innerWidth - size - 8);
      spot.x = Math.max(8, Math.min(maxX, spot.x));
      paint();
    };
    const step = (time) => {
      const delta = previous ? Math.min((time - previous) / 1000, 0.05) : 0;
      previous = time;
      spot.elapsed += delta;
      const walkingDuration = HOP_DURATION_SECONDS * 6;
      const cycle = spot.elapsed % (walkingDuration + 6);
      const rolling = cycle >= walkingDuration && cycle < walkingDuration + 3;
      const moving = cycle < walkingDuration + 3;
      const distance = moving ? delta * (rolling ? 90 : 42) * spot.direction : 0;
      spot.x += distance;
      if (spot.x <= 8 || spot.x >= maxX) {
        spot.x = Math.max(8, Math.min(maxX, spot.x));
        spot.direction *= -1;
      }
      spot.angle = rolling ? spot.angle + distance * 3 : 0;
      spot.pose = moving && !rolling ? getHopPose(cycle) : getHopPose(0);
      paint();
      frame = requestAnimationFrame(step);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!document.hidden && !still) frame = requestAnimationFrame(step);
    };
    resize(); resume();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", resume);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [still, speech, reduced, pet.paused, pet.sleeping, blocked]);
  return <div className="sxberty-playground" hidden={blocked}>
    {speech && <div ref={bubble} className="sxberty-bubble" role={speech.announce ? "status" : undefined}>{speech.text}</div>}
    <button ref={walker} type="button" className="sxberty-walker" aria-label="Visit Sxberty, your personal helper friend" aria-haspopup="dialog" onClick={onOpen}
      onPointerEnter={event => { if (event.pointerType !== "touch") setHeld(true); }} onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      <span ref={shadow} className="sxberty-shadow" aria-hidden="true" />
      <SxbertySprite ref={sprite} happiness={pet.happiness} size={84} />
      {pet.sleeping && <span className="sxberty-sleep-label" aria-hidden="true">zzz</span>}
    </button>
  </div>;
}

function HappinessHud({ pet, onOpen, blocked }) {
  const phase = getSxbertyPhase(pet.happiness);
  return <aside className="sxberty-hud" hidden={blocked} aria-label="Sxberty happiness" data-phase={phase}>
    <button type="button" onClick={onOpen} aria-haspopup="dialog" aria-label={`Care for Sxberty. Happiness ${happinessValue(pet)} out of 100. ${phaseLabel(phase)}.`}>
      <span className="sxberty-hud-heading"><SxbertySprite happiness={pet.happiness} size={34} /><strong>Sxberty</strong></span>
      <span className="sxberty-hud-value">Happiness <strong>{happinessValue(pet)}<small> / 100</small></strong></span>
      <meter min="0" max="100" low="20" high="80" optimum="100" value={pet.happiness} aria-label="Sxberty happiness">{happinessValue(pet)}%</meter>
      <span className="sxberty-hud-phase">{phaseLabel(phase)}<small>{pet.stage === "countdown" ? "Countdown started" : "−1 / minute"}</small></span>
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
  return <dialog ref={dialogRef} className="sxberty-dialog" aria-labelledby="sxberty-title"
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sxberty-card">
      <button className="sxberty-close" type="button" aria-label="Close Sxberty care" onClick={onClose}>×</button>
      <p className="sxberty-eyebrow">Your personal helper friend</p>
      <div className="sxberty-intro">
        <SxbertySprite happiness={pet.happiness} size={84} />
        <div><h2 id="sxberty-title">Sxberty</h2><p>{pet.sleeping ? `Sleeping · ${mood}` : mood}</p><small>Buddy {pet.generation} · Day {age} · Bond {pet.bond}</small></div>
      </div>
      <p className="sxberty-dialog-speech" role="status">{speech?.text || `Sxberty is feeling ${mood.toLowerCase()}.`}</p>
      <div className="sxberty-needs">
        {[["fullness", "Fullness"], ["happiness", "Happiness"], ["energy", "Energy"]].map(([key, label]) => <label key={key}>
          <span>{label}<strong>{key === "happiness" ? happinessValue(pet) : Math.round(pet[key])}<small> / 100</small></strong></span>
          <meter min="0" max="100" low="25" high="80" optimum="100" value={pet[key]}>{Math.round(pet[key])}%</meter>
        </label>)}
      </div>
      <div className="sxberty-care-actions">
        <button type="button" onClick={() => care("feed")} disabled={doomed || pet.sleeping}>Feed<small>A little snack</small></button>
        <button type="button" onClick={() => care("play")} disabled={doomed || pet.sleeping || pet.energy < 12}>Play<small>{pet.energy < 12 ? "Needs a nap first" : "+18 happiness"}</small></button>
        <button type="button" onClick={() => care("pet")} disabled={doomed || pet.sleeping}>Pet<small>+8 happiness</small></button>
        <button type="button" onClick={() => care("sleep")} disabled={doomed}>{pet.sleeping ? "Wake up" : "Sleep"}<small>{pet.sleeping ? "Hello again" : "Recharge energy"}</small></button>
      </div>
      <div className="sxberty-options">
        <button type="button" disabled={pet.sleeping} onClick={() => sayPhase(pet)}>Talk to Sxberty</button>
        <button type="button" onClick={() => care("pause")} aria-pressed={pet.paused} disabled={reduced}>{pet.paused ? "Resume roaming" : "Pause roaming"}</button>
        <button type="button" onClick={() => care("hide")}>Hide pet</button>
      </div>
      <p className="sxberty-warning">Happiness drops 1 point per minute, even while away. At 0, a {COUNTDOWN_MS / 1000}-second countdown changes the page from gray to red. Then comes the monster, and a new Sxberty forms.</p>
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

function FormingPet({ pet, now }) {
  const elapsed = useRef(Math.max(0, Math.min(FORMATION_MS, now - pet.stageStartedAt)));
  return <div className="sxberty-forming" role="status" style={{ "--sxberty-form-duration": `${FORMATION_MS}ms`, "--sxberty-form-delay": `-${elapsed.current}ms` }}>
    <p>A new Sxberty is forming…</p>
    <SxbertySprite happiness={100} size={84} />
    <span className="sxberty-form-ring" aria-hidden="true" />
  </div>;
}

export default function SxbertyPet({ pet, now, open, setOpen, saved, speech, sayPhase, care, trigger, scare, dismissScare, blocked = false }) {
  const reduced = useReducedMotion();
  const present = pet && ["alive", "countdown"].includes(pet.stage);
  const roaming = present && !pet.hidden && !pet.sleeping && !pet.paused && !open && !blocked && !scare;
  useEffect(() => {
    if (!roaming) return;
    const timer = setInterval(() => { if (!document.hidden) sayPhase(undefined, false); }, 35_000);
    return () => clearInterval(timer);
  }, [roaming, sayPhase]);
  if (!pet) return null;
  const onOpen = event => { trigger.current = event.currentTarget; setOpen(true); };
  return <>
    <SxbertyDoomScene pet={pet} now={now} obscured={blocked || open || Boolean(scare)} />
    {present && !pet.hidden && <>
      <HappinessHud pet={pet} onOpen={onOpen} blocked={blocked || open || Boolean(scare)} />
      <PetWalker key={pet.generation} pet={pet} speech={speech} onOpen={onOpen} blocked={blocked || open || Boolean(scare)} reduced={reduced} />
    </>}
    {present && open && !blocked && !scare && <PetDialog pet={pet} now={now} saved={saved} speech={speech} onClose={() => setOpen(false)} care={care} sayPhase={sayPhase} reduced={reduced} trigger={trigger} />}
    {pet.stage === "forming" && !blocked && <FormingPet key={pet.generation} pet={pet} now={now} />}
    {scare && <MonsterScare key={scare} onClose={dismissScare} reduced={reduced} />}
  </>;
}
