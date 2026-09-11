import { useCallback, useEffect, useRef, useState } from "react";
import FanartTile from "./FanartTile";
import MarkdownText from "./MarkdownText";
import { staticFanart } from "./fanartManifest";
import "./fanart-page.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function ArtworkImage({ entry }) {
  const [status, setStatus] = useState("loading");
  return (
    <div className="artwork-image-stage" aria-busy={status === "loading"}>
      {status === "loading" && <p className="artwork-image-message" role="status">Loading artwork…</p>}
      {status === "error" && <p className="artwork-image-message" role="alert">This artwork could not load. Try opening it again.</p>}
      <img src={`${API_BASE}${entry.url}`} alt={entry.title || `Fanart ${entry.id}`} hidden={status === "error"} onLoad={() => setStatus("ready")} onError={() => setStatus("error")} />
    </div>
  );
}

function ArtworkViewer({ entries, selected, onSelect, onClose }) {
  const dialogRef = useRef(null);
  const touchStart = useRef(null);
  const entry = entries[selected];
  const title = entry.title || `Fanart ${entry.id}`;
  const move = (direction) => onSelect((selected + direction + entries.length) % entries.length);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="artwork-viewer"
      aria-labelledby="artwork-title"
      aria-describedby={entry.hoverMarkdown ? "artwork-notes" : undefined}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          move(event.key === "ArrowRight" ? 1 : -1);
        }
      }}
    >
      <button type="button" className="artwork-close" aria-label="Close artwork" onClick={onClose} autoFocus>×</button>
      {entries.length > 1 && <button type="button" className="artwork-arrow artwork-previous" aria-label="Previous artwork" onClick={() => move(-1)}>‹</button>}
      <figure className="artwork-figure" onTouchStart={(event) => {
        touchStart.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
      }} onTouchEnd={(event) => {
        if (!touchStart.current || !event.changedTouches[0]) return;
        const dx = event.changedTouches[0].clientX - touchStart.current.x;
        const dy = event.changedTouches[0].clientY - touchStart.current.y;
        touchStart.current = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
      }} onTouchCancel={() => { touchStart.current = null; }}>
        <ArtworkImage key={entry.filename} entry={entry} />
        <figcaption className="artwork-caption" aria-live="polite">
          <p className="artwork-position">{selected + 1} / {entries.length}</p>
          <h2 id="artwork-title">{title}</h2>
          {entry.hoverMarkdown?.trim() && <div id="artwork-notes"><MarkdownText value={entry.hoverMarkdown} /></div>}
        </figcaption>
      </figure>
      {entries.length > 1 && <button type="button" className="artwork-arrow artwork-next" aria-label="Next artwork" onClick={() => move(1)}>›</button>}
    </dialog>
  );
}

export default function FanartPage() {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("loading");
  const [selected, setSelected] = useState(null);
  const close = useCallback(() => setSelected(null), []);

  useEffect(() => {
    const controller = new AbortController();
    const previousTitle = document.title;
    document.title = "Fanart • thesxber.com";
    fetch(`${API_BASE}/api/fanart`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Fanart request failed");
        const data = await response.json();
        if (!Array.isArray(data.items)) throw new Error("Invalid fanart response");
        if (!controller.signal.aborted) { setEntries(data.items); setStatus("ready"); }
      })
      .catch(() => {
        if (!controller.signal.aborted) { setEntries(staticFanart); setStatus("fallback"); }
      });
    return () => { controller.abort(); document.title = previousTitle; };
  }, []);

  return (
    <>
      <main className="fanart-page" aria-labelledby="fanart-page-title">
        <nav className="fanart-navigation" aria-label="Site navigation">
          <a className="fanart-home" href="/">← Home</a>
          <a className="fanart-brand" href="/">thesxber.com</a>
          <a className="fanart-current" href="/fanart" aria-current="page">Fanart</a>
        </nav>
        <header className="fanart-heading">
          <h1 id="fanart-page-title">Fanart Gallery</h1>
          <p>Made by the community. Open a piece to take a closer look.</p>
        </header>
        {status === "loading" && <p className="fanart-status" role="status">Loading the gallery…</p>}
        {status === "fallback" && <p className="fanart-status" role="status">Live updates are unavailable. Showing the saved collection.</p>}
        {status === "ready" && !entries.length && <p className="fanart-status">The gallery is waiting for its first piece.</p>}
        <div className="fanart-grid">
          {entries.map((entry, index) => <FanartTile key={entry.filename} entry={entry} onOpenLightbox={() => setSelected(index)} />)}
        </div>
        {entries.length > 0 && <footer className="fanart-footer">{entries.length} {entries.length === 1 ? "piece" : "pieces"} of fanart <span aria-hidden="true">·</span> Thank you for creating ♥</footer>}
      </main>
      {selected !== null && entries[selected] && <ArtworkViewer entries={entries} selected={selected} onSelect={setSelected} onClose={close} />}
    </>
  );
}
