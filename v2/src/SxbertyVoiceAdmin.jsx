import { useEffect, useRef } from "react";
import AdminSection from "./AdminSection";
import { SXBERTY_VOICE_CAPTION_MAX_LENGTH, SXBERTY_VOICE_MAX_BYTES, SXBERTY_VOICE_NAME_MAX_LENGTH, SXBERTY_VOICE_TRIGGERS, validateSxbertyVoiceCreate } from "../shared/sxberty-voices.js";
import { getSxbertyVoiceCounts, getSxbertyVoiceDraftError, sxbertyVoiceDraftKey } from "./sxberty-voice-drafts.js";

function TriggerOptions() {
  return SXBERTY_VOICE_TRIGGERS.map(trigger => <option key={trigger.id} value={trigger.id}>{trigger.label}</option>);
}

function VoicePreview({ url, name, onPlay }) {
  const audioRef = useRef(null);
  useEffect(() => {
    const audio = audioRef.current;
    return () => { audio?.pause(); };
  }, [url]);
  return <audio ref={audioRef} controls preload="none" crossOrigin="use-credentials" src={url} style={{ width: "100%" }} aria-label={`Preview ${name}`} onPlay={onPlay} />;
}

export default function SxbertyVoiceAdmin({ items = [], drafts = {}, errors = {}, loading, loadError, actionError, message, busy, ready, apiBase = "", onRetry, onChange, onUpload, onUploadError, onRemove }) {
  const rootRef = useRef(null);
  const counts = getSxbertyVoiceCounts(items, drafts, errors);
  useEffect(() => {
    const root = rootRef.current;
    const sections = [root.querySelector("details")];
    for (let parent = root.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS") sections.push(parent);
    }
    const pauseAll = () => root.querySelectorAll("audio").forEach(audio => audio.pause());
    const onToggle = event => { if (!event.currentTarget.open) pauseAll(); };
    const onVisibility = () => { if (document.hidden) pauseAll(); };
    sections.forEach(section => section.addEventListener("toggle", onToggle));
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      pauseAll();
      sections.forEach(section => section.removeEventListener("toggle", onToggle));
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  function playPreview(event) {
    const audio = event.currentTarget;
    let hidden = document.hidden;
    for (let parent = audio.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS" && !parent.open) hidden = true;
    }
    rootRef.current.querySelectorAll("audio").forEach(other => { if (hidden || other !== audio) other.pause(); });
  }
  async function upload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    onUploadError("");
    try {
      const file = form.elements.file.files?.[0];
      if (!file || !/\.mp3$/i.test(file.name)) throw new Error("Choose an MP3 file to upload.");
      if (!file.size || file.size > SXBERTY_VOICE_MAX_BYTES) throw new Error("Choose a nonempty MP3 file up to 5 MB.");
      const metadata = validateSxbertyVoiceCreate({ name: form.elements.name.value, enabled: form.elements.enabled.checked, trigger: form.elements.trigger.value, caption: form.elements.caption.value });
      const data = new FormData();
      data.set("file", file);
      for (const [key, value] of Object.entries(metadata)) data.set(key, String(value));
      if (await onUpload(data)) form.reset();
    } catch (error) { onUploadError(error.message); }
  }
  return <div ref={rootRef}>
    <AdminSection title="Voice lines" count={items.length} dirty={counts.dirty}
      errors={counts.errors + Number(Boolean(loadError)) + Number(Boolean(actionError))}>
      <p className="admin-copy" id="sxberty-voice-help">Upload MP3 voice lines for matching happiness phases and actions. Visitors must enable voice audio before playback; only one line plays at a time. Existing text phrases stay in place. Uploads and removals publish immediately; metadata edits below use Save all.</p>
      {ready && <button type="button" disabled={busy || loading} onClick={onRetry}>Refresh voice lines</button>}
      {loading && <p role="status">Loading Sxberty voice lines…</p>}
      {loadError && <div className="admin-row-error" role="alert"><p>{loadError}</p><button type="button" disabled={busy || loading} onClick={onRetry}>Retry loading Sxberty voice lines</button></div>}
      <form className="admin-form" onSubmit={upload} onChange={() => onUploadError("")}>
        <fieldset className="admin-upload-fields" disabled={busy || !ready}>
          <legend>Upload voice line</legend>
          <label>Voice name<input name="name" required maxLength={SXBERTY_VOICE_NAME_MAX_LENGTH} /></label>
          <label>Voice MP3<input name="file" type="file" accept="audio/mpeg,.mp3" required /></label>
          <small>MP3 only, up to 5 MB and 30 seconds. Duration is checked on upload and cannot be edited.</small>
          <label>Speech trigger<select name="trigger" defaultValue="happy"><TriggerOptions /></select></label>
          <label className="admin-embed-toggle"><input name="enabled" type="checkbox" defaultChecked /> Enabled for voice playback</label>
          <label>Optional caption<input name="caption" maxLength={SXBERTY_VOICE_CAPTION_MAX_LENGTH} placeholder="Leave blank to keep the current speech bubble" /></label>
          <small>A caption replaces the bubble only when this voice is chosen. Blank captions keep Sxberty’s current phrase.</small>
          <button className="admin-submit" type="submit">Upload voice line now</button>
        </fieldset>
      </form>
      {actionError && <p className="admin-row-error" role="alert">{actionError}</p>}
      {message && <p role="status">{message}</p>}
      {ready && !items.length && <p>No voice lines yet. Upload an MP3 to add optional voice playback.</p>}
      <div className="admin-list admin-entry-grid">{items.map(entry => {
        const key = sxbertyVoiceDraftKey(entry.id), value = { ...entry, ...drafts[key] };
        const error = errors[key] || getSxbertyVoiceDraftError(drafts[key]);
        const preview = `${apiBase}/api/admin/sxberty-voices/${encodeURIComponent(entry.id)}/audio`;
        return <fieldset className={`admin-list-row emoji-admin-row${drafts[key] ? " admin-row-dirty" : ""}`} key={entry.id} disabled={busy}>
          <div className="admin-list-editor">
            <VoicePreview url={preview} name={entry.name} onPlay={playPreview} />
            <small>Duration: {(entry.durationMs / 1000).toFixed(2)} seconds (read-only). Previews never autoplay.</small>
            <label>Name<input value={value.name} maxLength={SXBERTY_VOICE_NAME_MAX_LENGTH} required onChange={event => onChange(entry, { name: event.target.value })} /></label>
            <label>Speech trigger<select value={value.trigger} onChange={event => onChange(entry, { trigger: event.target.value })}><TriggerOptions /></select></label>
            <label className="admin-embed-toggle"><input type="checkbox" checked={value.enabled} onChange={event => onChange(entry, { enabled: event.target.checked })} /> Enabled for voice playback</label>
            <label>Optional caption<input value={value.caption} maxLength={SXBERTY_VOICE_CAPTION_MAX_LENGTH} placeholder="Keep the current speech bubble" onChange={event => onChange(entry, { caption: event.target.value })} /></label>
            <small>Disabled lines remain available here for previews but cannot play for visitors.</small>
            {error && <p className="admin-row-error" role="alert">{error}</p>}
            <div className="admin-list-actions"><button type="button" onClick={() => { if (window.confirm(`Remove ${entry.name}? This immediately deletes the voice line and any unsaved edits.`)) onRemove(entry); }}>Remove voice line</button></div>
          </div>
        </fieldset>;
      })}</div>
    </AdminSection>
  </div>;
}
