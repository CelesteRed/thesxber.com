import { useEffect, useRef, useState } from "react";
import SxbertySprite from "./SxbertySprite";
import { getSxbertyPhase, SXBERTY_PHASES } from "../shared/sxberty.js";
import { getPetPresence } from "./verity-pet.js";
import "./sxberty-console.css";

const SLIDE_MS = 320;

export default function SxbertyConsole({ pet, now, isOpen, onClose, speech, saved, care, sayPhase, reduced, trigger, voiceControl, voiceStatus }) {
  const panel = useRef(null);
  const returnTo = useRef(null);
  const latestOpen = useRef(isOpen);
  latestOpen.current = isOpen;
  const [shown, setShown] = useState(isOpen);
  const [state, setState] = useState("closed");

  useEffect(() => {
    let frame = 0;
    let timer = 0;
    if (isOpen) {
      returnTo.current = trigger.current;
      setShown(true);
      setState(reduced ? "open" : "opening");
      frame = requestAnimationFrame(() => {
        if (!latestOpen.current) return;
        setState("open");
        panel.current?.querySelector(".sxberty-console-close")?.focus({ preventScroll: true });
      });
    } else if (shown) {
      if (panel.current?.contains(document.activeElement)) {
        const target = returnTo.current instanceof HTMLElement && returnTo.current.isConnected && !returnTo.current.closest("[hidden]")
          ? returnTo.current : document.querySelector(".top-domain");
        target?.focus({ preventScroll: true });
      }
      setState("closing");
      if (reduced) { setShown(false); setState("closed"); }
      else timer = setTimeout(() => {
        if (!latestOpen.current) { setShown(false); setState("closed"); }
      }, SLIDE_MS + 40);
    }
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
    // `shown` only tracks the exit presence; don't restart an entry on stats.
  }, [isOpen, reduced]);

  useEffect(() => {
    if (!isOpen) return;
    const escape = event => {
      if (event.key !== "Escape" || document.querySelector('dialog[open], .modal[aria-modal="true"]')) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [isOpen, onClose]);

  if (!shown) return null;
  const presence = getPetPresence(pet, now);
  const mood = SXBERTY_PHASES.find(item => item.id === getSxbertyPhase(pet.happiness))?.label || "Happy";
  const unavailable = pet.stage !== "alive" || presence.state !== "present";
  const asleep = pet.sleeping;
  const status = presence.state === "absent" ? "Away" : presence.state === "falling" ? "Returning" : asleep ? "Sleeping" : mood;
  return <section ref={panel} role="dialog" aria-modal="false" aria-labelledby="sxberty-console-title"
    className="sxberty-console" data-state={state} aria-hidden={!isOpen} inert={!isOpen}
    onTransitionEnd={event => {
      if (event.target === event.currentTarget && event.propertyName === "transform" && !latestOpen.current) {
        setShown(false); setState("closed");
      }
    }}>
    <header className="sxberty-console-header">
      <span className="sxberty-console-brand">SXBER <strong>POCKET</strong></span>
      <button type="button" className="sxberty-console-close" onClick={onClose} aria-label="Close Sxberty console">×</button>
    </header>
    <div className="sxberty-console-bezel">
      <span className="sxberty-console-power" aria-hidden="true" /><span className="sxberty-console-screen-label" aria-hidden="true">DOT MATRIX</span>
      <div className="sxberty-console-screen">
        <div className="sxberty-console-character">
          <SxbertySprite happiness={pet.happiness} face={presence.face} size={64} />
          <div><h2 id="sxberty-console-title">Sxberty</h2><p>{status}</p><small>Buddy {pet.generation} · Bond {pet.bond}</small></div>
        </div>
        <p className="sxberty-console-speech" role="status">{speech?.text || "…"}</p>
        <div className="sxberty-console-stats">
          {[["fullness", "Fullness"], ["happiness", "Happiness"], ["energy", "Energy"]].map(([key, label]) => <label key={key}>
            <span>{label}<strong>{Math.ceil(pet[key])}</strong></span>
            <meter min="0" max="100" value={pet[key]} aria-label={label}>{Math.ceil(pet[key])}%</meter>
          </label>)}
        </div>
        {!saved && <p className="sxberty-console-error" role="status">Not saved</p>}
        {voiceStatus.blocked && <p className="sxberty-console-error" role="status">Audio unavailable</p>}
      </div>
    </div>
    <div className="sxberty-console-controls">
      <div className="sxberty-console-dpad" role="group" aria-label="Sxberty controls">
        <button type="button" className="sxberty-console-talk" disabled={asleep || presence.state !== "present"} onClick={() => sayPhase(pet)} aria-label="Talk to Sxberty" title="Talk">Talk</button>
        <button type="button" className="sxberty-console-roam" disabled={reduced} onClick={() => care("pause")} aria-label={pet.paused ? "Resume roaming" : "Pause roaming"} aria-pressed={pet.paused} title={pet.paused ? "Resume roaming" : "Pause roaming"}>Roam</button>
        <span aria-hidden="true" />
        <button type="button" className="sxberty-console-hide" onClick={() => care("hide")} aria-label="Hide Sxberty" title="Hide Sxberty">Hide</button>
        <button type="button" className="sxberty-console-sleep" disabled={unavailable} onClick={() => care("sleep")} aria-label={asleep ? "Wake Sxberty" : "Put Sxberty to sleep"} title={asleep ? "Wake" : "Sleep"}>{asleep ? "Wake" : "Sleep"}</button>
      </div>
      <div className="sxberty-console-action-buttons">
        <div><button type="button" disabled={unavailable || asleep || pet.energy < 12} onClick={() => care("play")} aria-label="Play with Sxberty" title="Play">B</button><span>PLAY</span></div>
        <div><button type="button" disabled={unavailable || asleep} onClick={() => care("pet")} aria-label="Pet Sxberty" title="Pet">A</button><span>PET</span></div>
      </div>
    </div>
    <footer className="sxberty-console-footer">
      {voiceControl}
      <span className="sxberty-console-speaker" aria-hidden="true"><i /><i /><i /><i /></span>
    </footer>
  </section>;
}
