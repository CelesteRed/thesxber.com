import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { startFloatingEmojis } from "./floating-emojis.js";
import { createEmojiUnlockTracker, emojiUnlockCookie, hasEmojiUnlock } from "./emoji-unlock.js";

const MotionContext = createContext(null);
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export function PublicAtmosphere({ children, gallery = false }) {
  const [unlocked, setUnlocked] = useState(() => hasEmojiUnlock(document.cookie));
  const [showUnlockToast, setShowUnlockToast] = useState(false);
  const interactionTracker = useRef(null);
  if (!interactionTracker.current) {
    interactionTracker.current = createEmojiUnlockTracker(() => {
      setUnlocked(true);
      setShowUnlockToast(true);
      try { document.cookie = emojiUnlockCookie(location.protocol === "https:"); } catch {}
    }, unlocked);
  }
  const onEmojiInteraction = useCallback(type => interactionTracker.current(type), []);
  const [items, setItems] = useState([]);
  const [defaultCount, setDefaultCount] = useState(null);
  const [personalCount, setPersonalCount] = useState(() => {
    if (!unlocked) return null;
    try {
      const saved = sessionStorage.getItem("sxber-emoji-count");
      if (saved !== null && Number.isInteger(Number(saved)) && Number(saved) >= 0 && Number(saved) <= 100) return Number(saved);
    } catch {}
    return null;
  });
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const count = personalCount ?? (reducedMotion ? 0 : defaultCount ?? 0);
  const layer = useRef(null);
  useEffect(() => {
    if (!showUnlockToast) return;
    const timer = setTimeout(() => setShowUnlockToast(false), 4500);
    return () => clearTimeout(timer);
  }, [showUnlockToast]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/emojis`, { signal: controller.signal }).then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data?.items)) setItems(data.items);
        setDefaultCount(Number.isInteger(data?.settings?.count) ? data.settings.count : 10);
      }).catch(() => { if (!controller.signal.aborted) setDefaultCount(10); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (items.length) return startFloatingEmojis(layer.current, items, API_BASE, gallery, count, onEmojiInteraction);
  }, [items, gallery, count, onEmojiInteraction]);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);
  const changeCount = (value) => {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(100, Math.round(value)));
    setPersonalCount(next);
    try { sessionStorage.setItem("sxber-emoji-count", String(next)); } catch {}
  };
  return <MotionContext.Provider value={{ count, changeCount, ready: defaultCount !== null, unlocked }}>
    {children}<div ref={layer} className="floating-emoji-layer" aria-label="Floating emojis" />
    <div className="emoji-unlock-announcement" role="status" aria-live="polite">
      {showUnlockToast && <div className="emoji-unlock-toast">Emoji Easter Egg Unlocked</div>}
    </div>
  </MotionContext.Provider>;
}
export default function SiteCredit() {
  const motion = useContext(MotionContext);
  return <div className="site-credit">
    {motion?.unlocked && <div className="emoji-count-control" role="group" aria-label="Emoji count">
      <label htmlFor="visitor-emoji-count">Emoji count</label>
      <button type="button" aria-label="Fewer emojis" disabled={!motion.ready || motion.count === 0} onClick={() => motion.changeCount(motion.count - 1)}>−</button>
      <input id="visitor-emoji-count" type="number" min={0} max={100} step={1} value={motion.count} disabled={!motion.ready}
        onChange={event => motion.changeCount(Number(event.target.value))} />
      <button type="button" aria-label="More emojis" disabled={!motion.ready || motion.count === 100} onClick={() => motion.changeCount(motion.count + 1)}>+</button>
    </div>}
    <span>made by <a href="https://github.com/CelesteRed" target="_blank" rel="noreferrer">@celeste</a> &amp; <a href="https://youtube.com/@itzbogged" target="_blank" rel="noreferrer">@bogged</a></span>
  </div>;
}
