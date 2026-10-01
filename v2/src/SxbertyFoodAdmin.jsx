import AdminSection from "./AdminSection";
import { SXBERTY_FOOD_NAME_MAX_LENGTH } from "../shared/sxberty-foods.js";
import { getSxbertyFoodCounts, getSxbertyFoodDraftError, SXBERTY_FOOD_DEFAULT_GAINS, sxbertyFoodDraftKey } from "./sxberty-food-drafts.js";

const GAINS = [["fullness", "Fullness"], ["happiness", "Happiness"], ["energy", "Energy"]];

export default function SxbertyFoodAdmin({ items = [], drafts = {}, errors = {}, loading, loadError, actionError, message, busy, ready, apiBase = "", onRetry, onChange, onUpload, onRemove }) {
  const counts = getSxbertyFoodCounts(items, drafts, errors);
  async function upload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("enabled", String(form.elements.enabled.checked));
    if (await onUpload(data)) form.reset();
  }
  return <AdminSection title="Foods" count={items.length} dirty={counts.dirty}
    errors={counts.errors + Number(Boolean(loadError)) + Number(Boolean(actionError))}>
    <p className="admin-copy">Upload and enable foods first. Every minute there is an independent 20% chance for food to appear; a spawn is never guaranteed. Only food Sxberty eats grants these stat gains. Uploads and removals publish immediately; edits below use Save all.</p>
    {loading && <p role="status">Loading Sxberty foods…</p>}
    {loadError && <div className="admin-row-error" role="alert"><p>{loadError}</p><button type="button" disabled={busy || loading} onClick={onRetry}>Retry loading Sxberty foods</button></div>}
    <form className="admin-form" onSubmit={upload}>
      <fieldset className="admin-upload-fields" disabled={busy || !ready}>
        <legend>Upload food</legend>
        <label>Food name<input name="name" required maxLength={SXBERTY_FOOD_NAME_MAX_LENGTH} /></label>
        <label>Food PNG<input name="file" type="file" accept="image/png,.png" required /></label>
        <small>PNG only, up to 3 MB. Transparent backgrounds work best.</small>
        {GAINS.map(([key, label]) => <label key={key}>{label} gain<input name={key} type="number" min={0} max={100} step={1} required defaultValue={SXBERTY_FOOD_DEFAULT_GAINS[key]} /></label>)}
        <label className="admin-embed-toggle"><input name="enabled" type="checkbox" defaultChecked /> Enabled for food spawns</label>
        <button className="admin-submit" type="submit">Upload food now</button>
      </fieldset>
    </form>
    {actionError && <p className="admin-row-error" role="alert">{actionError}</p>}
    {message && <p role="status">{message}</p>}
    {ready && !items.length && <p>No foods yet. Upload a PNG to make food spawns possible.</p>}
    <div className="admin-list admin-entry-grid">{items.map(entry => {
      const key = sxbertyFoodDraftKey(entry.id), value = { ...entry, ...drafts[key] };
      const error = errors[key] || getSxbertyFoodDraftError(drafts[key]);
      const preview = `${apiBase}${entry.adminPreviewUrl || `/api/admin/sxberty-foods/${encodeURIComponent(entry.id)}/image`}`;
      return <fieldset className={`admin-list-row emoji-admin-row${drafts[key] ? " admin-row-dirty" : ""}`} key={entry.id} disabled={busy}>
        <div className="emoji-admin-preview"><img src={preview} alt={entry.name} loading="lazy" /><a href={preview} target="_blank" rel="noreferrer">View PNG ↗</a></div>
        <div className="admin-list-editor">
          <label>Name<input value={value.name} maxLength={SXBERTY_FOOD_NAME_MAX_LENGTH} required onChange={event => onChange(entry, { name: event.target.value })} /></label>
          <label className="admin-embed-toggle"><input type="checkbox" checked={value.enabled} onChange={event => onChange(entry, { enabled: event.target.checked })} /> Enabled for food spawns</label>
          {GAINS.map(([field, label]) => <label key={field}>{label} gain<input type="number" min={0} max={100} step={1} required value={value[field]} onChange={event => onChange(entry, { [field]: event.target.value === "" ? "" : Number(event.target.value) })} /></label>)}
          <small>Each gain is a whole number from 0 to 100. Disabled foods stay in this library but cannot spawn.</small>
          {error && <p className="admin-row-error" role="alert">{error}</p>}
          <div className="admin-list-actions"><button type="button" onClick={() => { if (window.confirm(`Remove ${entry.name}? This immediately deletes the food and any unsaved edits.`)) onRemove(entry); }}>Remove food</button></div>
        </div>
      </fieldset>;
    })}</div>
  </AdminSection>;
}
