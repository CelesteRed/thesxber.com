import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bannerLayout, clampBannerCrop, DEFAULT_BANNER_CROP, MAX_BANNER_ZOOM } from "../server/banner-crop.js";

export default function BannerCropEditor({ entry, sourceUrl, onSave, onClose }) {
  const dialog = useRef(null);
  const drag = useRef(null);
  const [source, setSource] = useState(null);
  const [crop, setCrop] = useState(entry.embedCrop || DEFAULT_BANNER_CROP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const layout = source && bannerLayout(source.width, source.height, crop);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current;
    element.showModal();
    return () => { element.close(); previousFocus?.focus(); };
  }, []);

  const update = (next) => source && setCrop(clampBannerCrop(source.width, source.height, next));
  const endDrag = (event) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const save = async (value) => {
    setBusy(true);
    setError("");
    try { await onSave(value); onClose(); }
    catch (caught) { setError(caught.message); setBusy(false); }
  };

  return createPortal(
    <dialog ref={dialog} className="banner-crop-dialog" aria-labelledby="banner-crop-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      <header className="banner-crop-header">
        <div><h2 id="banner-crop-title">Crop embed banner</h2><p>{entry.title || entry.filename} · 4:1 · 1200 × 300</p></div>
        <button type="button" aria-label="Close crop editor" onClick={onClose} disabled={busy}>×</button>
      </header>
      <div className="banner-crop-body">
        <div className="banner-crop-frame" tabIndex={0} role="group" aria-label="Banner crop area" aria-describedby="banner-crop-help"
          onPointerDown={(event) => {
            if (busy || !source || event.button !== 0 || drag.current) return;
            event.preventDefault(); event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { crop, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (!start || start.pointerId !== event.pointerId) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            update({ ...start.crop, offsetX: start.crop.offsetX + (event.clientX - start.x) / rect.width * 4,
              offsetY: start.crop.offsetY + (event.clientY - start.y) / rect.height });
          }}
          onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; }}
          onKeyDown={(event) => {
            const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (!movement || busy || !source) return;
            event.preventDefault();
            const step = event.shiftKey ? 0.1 : 0.02;
            update({ ...crop, offsetX: crop.offsetX + movement[0] * step, offsetY: crop.offsetY + movement[1] * step });
          }}>
          {!source && <span>Loading image…</span>}
          <img src={sourceUrl} alt="" draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              setSource({ width: image.naturalWidth, height: image.naturalHeight });
              setCrop(current => clampBannerCrop(image.naturalWidth, image.naturalHeight, current));
            }}
            onError={() => setError("Unable to load the image. Close the editor and try again, or sign in again.")}
            style={layout ? { width: `${layout.width / 4 * 100}%`, height: `${layout.height * 100}%`,
              left: `${50 + layout.offsetX / 4 * 100}%`, top: `${50 + layout.offsetY * 100}%` } : { visibility: "hidden" }} />
        </div>
        <p id="banner-crop-help">Drag to reposition, or focus the image and use the arrow keys. Zoom to frame your banner. Use this crop to stage it, then publish it with Save all.</p>
        <label className="banner-crop-zoom">Zoom
          <input type="range" min={1} max={MAX_BANNER_ZOOM} step={0.01} value={crop.zoom} disabled={busy || !source}
            onChange={(event) => update({ ...crop, zoom: Number(event.target.value) })} />
          <output>{Math.round(crop.zoom * 100)}%</output>
        </label>
        {error && <p className="banner-crop-error" role="alert">{error}</p>}
      </div>
      <footer className="banner-crop-actions">
        <button type="button" disabled={busy || !source} onClick={() => update(DEFAULT_BANNER_CROP)}>Reset position</button>
        <button type="button" disabled={busy || !source} onClick={() => save(null)}>Use automatic crop</button>
        <div><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="banner-crop-save" disabled={busy || !source} onClick={() => save(crop)}>{busy ? "Applying…" : "Use this crop"}</button></div>
      </footer>
    </dialog>, document.body
  );
}
