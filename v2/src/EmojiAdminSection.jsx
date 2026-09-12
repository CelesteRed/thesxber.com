import { useState } from "react";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export function updateEmojiDraft(entry, draft, changes) {
  const result = { ...draft, ...changes };
  for (const key of Object.keys(result)) if (JSON.stringify(result[key]) === JSON.stringify(entry[key])) delete result[key];
  return result;
}
export default function EmojiAdminSection({ items, settings, drafts, errors, busy, onSettingsChange, onChange, onUploaded, onRemove }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  async function upload(event) {
    event.preventDefault(); const form = event.currentTarget;
    setUploading(true); setMessage("Uploading emoji…");
    try {
      const response = await fetch(`${API_BASE}/api/admin/emojis`, { method: "POST", credentials: "include", body: new FormData(form) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to upload emoji");
      onUploaded(data.item); form.reset(); setMessage("Emoji uploaded. Add quotes below, then Save all.");
    } catch (error) { setMessage(error.message); }
    finally { setUploading(false); }
  }
  return <section className="admin-emojis" aria-labelledby="emoji-title">
    <h2 id="emoji-title">Floating emojis</h2>
    <fieldset className="emoji-controller admin-list-editor" disabled={busy || !settings}>
      <legend>Emoji controller</legend>
      <label>Default emoji count<input type="number" min={0} max={30} step={1}
        value={drafts["emoji-settings"]?.count ?? settings?.count ?? ""}
        onChange={event => onSettingsChange(event.target.value === "" ? "" : Number(event.target.value))} /></label>
      <small>0–30 emojis on visitors’ home and fanart pages. Set 0 to turn them off. Save all publishes this default for subsequent page loads. Visitors can still hide emojis, and slower devices may show fewer.</small>
      {errors["emoji-settings"] && <p className="admin-row-error" role="alert">{errors["emoji-settings"]}</p>}
    </fieldset>
    <p className="admin-copy">Emojis bounce around the home and fanart pages. Visitors can grab, drag and throw them. Uploads and removals publish immediately; edits use Save all.</p>
    <form className="admin-form" onSubmit={upload}><fieldset className="admin-upload-fields" disabled={busy || uploading}>
      <label>Emoji name<input name="name" required maxLength={60} /></label>
      <label>Emoji image<input name="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required /></label>
      <small>PNG, GIF, WebP or JPEG, up to 3 MB. Transparency and animation are preserved; originals stay available here.</small>
      <button className="admin-submit" type="submit">{uploading ? "Uploading…" : "Upload emoji"}</button>
    </fieldset></form>
    <p role="status">{message}</p>
    {!items.length && <p>No emojis yet. Upload the first one to start the floating effect.</p>}
    <div className="admin-list">{items.map(entry => {
      const key = `emoji:${entry.id}`, value = { ...entry, ...drafts[key] };
      return <fieldset className={`admin-list-row emoji-admin-row${drafts[key] ? " admin-row-dirty" : ""}`} key={entry.id} disabled={busy}>
        <div className="emoji-admin-preview"><img src={`${API_BASE}/api/admin/emojis/${entry.id}/original`} alt={entry.name} />
          <a href={`${API_BASE}/api/admin/emojis/${entry.id}/original`} target="_blank" rel="noreferrer">View original ↗</a></div>
        <div className="admin-list-editor">
          <label>Name<input value={value.name} maxLength={60} onChange={e => onChange(entry, { name: e.target.value })} /></label>
          <label className="admin-embed-toggle"><input type="checkbox" checked={value.enabled} onChange={e => onChange(entry, { enabled: e.target.checked })} /> Show on the site</label>
          {[["quotes", "Random quotes"], ["heldQuotes", "Quotes when grabbed"], ["fanartQuotes", "Fanart page quotes (optional)"], ["links", "Click links (optional)"]].map(([field, label]) =>
            <label key={field}>{label}<textarea rows={3} value={value[field].join("\n")} onChange={e => onChange(entry, { [field]: e.target.value.split("\n") })} placeholder={field === "links" ? "https://…" : "One quote per line"} /></label>)}
          <small>Up to 30 lines per box. Quotes support light Markdown, 100 characters per line. Blank quotes use friendly defaults; blank fanart quotes use the random quotes. Clicks choose a random HTTP/HTTPS link; dragging never opens one.</small>
          {errors[key] && <p className="admin-row-error" role="alert">{errors[key]}</p>}
          <div className="admin-list-actions"><button type="button" onClick={() => onRemove(entry)}>Remove emoji</button></div>
        </div>
      </fieldset>;
    })}</div>
  </section>;
}
