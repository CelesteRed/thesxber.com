import { createContext, useContext, useEffect, useRef, useState } from "react";
import { startFloatingEmojis } from "./floating-emojis.js";

const MotionContext = createContext(null);
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export function PublicAtmosphere({ children, gallery = false }) {
  const [items, setItems] = useState([]);
  const [visible, setVisible] = useState(() => {
    try { const saved = sessionStorage.getItem("sxber-emojis"); if (saved !== null) return saved === "on"; } catch {}
    return !matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  const layer = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/emojis`, { signal: controller.signal }).then(r => r.ok ? r.json() : null)
      .then(data => { if (Array.isArray(data?.items)) setItems(data.items); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (visible && items.length) return startFloatingEmojis(layer.current, items, API_BASE, gallery);
  }, [visible, items, gallery]);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => { if (preference.matches) setVisible(false); };
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);
  const toggle = () => setVisible(current => { try { sessionStorage.setItem("sxber-emojis", current ? "off" : "on"); } catch {} return !current; });
  return <MotionContext.Provider value={{ visible, toggle, available: items.length > 0 }}>
    {children}<div ref={layer} className="floating-emoji-layer" aria-label="Floating emojis" />
  </MotionContext.Provider>;
}
export default function SiteCredit() {
  const motion = useContext(MotionContext);
  return <div className="site-credit"><a href="https://github.com/CelesteRed" target="_blank" rel="noreferrer">made by @celestered</a>
    {motion?.available && <button type="button" onClick={motion.toggle} aria-pressed={motion.visible}>{motion.visible ? "Hide emojis" : "Show emojis"}</button>}
  </div>;
}
