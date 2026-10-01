import { createContext, useContext, useEffect, useRef, useState } from "react";
import { startFloatingEmojis } from "./floating-emojis.js";
import { installEmojiParty } from "./emoji-party.js";

const MotionContext = createContext(null);
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export function PublicAtmosphere({ children, gallery = false }) {
  const [unlocked, setUnlocked] = useState(false);
  const [items, setItems] = useState([]);
  const [defaultCount, setDefaultCount] = useState(null);
  const [personalCount, setPersonalCount] = useState(null);
  // Every visit starts still, including returning and reduced-motion visitors.
  // Running the console command explicitly opts into motion for this page only.
  const count = unlocked ? personalCount ?? defaultCount ?? 0 : 0;
  const layer = useRef(null);
  useEffect(() => installEmojiParty(window, () => setUnlocked(true)), []);
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
    if (items.length && count > 0) return startFloatingEmojis(layer.current, items, API_BASE, gallery, count);
  }, [items, gallery, count]);
  const changeCount = (value) => {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0, Math.min(100, Math.round(value)));
    setPersonalCount(next);
  };
  return <MotionContext.Provider value={{ count, changeCount, ready: defaultCount !== null, unlocked }}>
    {children}<div ref={layer} className="floating-emoji-layer" aria-label="Floating emojis" />
  </MotionContext.Provider>;
}
export default function SiteCredit() {
  const motion = useContext(MotionContext);
  if (!motion?.unlocked) return null;
  return <div className="site-credit">
    {motion?.unlocked && <div className="emoji-count-control" role="group" aria-label="Emoji count">
      <label htmlFor="visitor-emoji-count">Emoji count</label>
      <button type="button" aria-label="Fewer emojis" disabled={!motion.ready || motion.count === 0} onClick={() => motion.changeCount(motion.count - 1)}>−</button>
      <input id="visitor-emoji-count" type="number" min={0} max={100} step={1} value={motion.count} disabled={!motion.ready}
        onChange={event => motion.changeCount(Number(event.target.value))} />
      <button type="button" aria-label="More emojis" disabled={!motion.ready || motion.count === 100} onClick={() => motion.changeCount(motion.count + 1)}>+</button>
    </div>}
  </div>;
}
