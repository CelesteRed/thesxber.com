import { useEffect, useState } from "react";
import AdminSection from "./AdminSection";

const dateLabel = value => value ? new Date(value).toLocaleString() : "Not synced yet";
export default function VideoAdminSection({ data, drafts, errors, busy, syncing, message, onSync, onRefresh, onChange }) {
  const [clock, setClock] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  // Translate the server's deadline into a local countdown; client time never authorizes a sync.
  const offset = data?.receivedAt ? Date.parse(data.sync.serverTime) - data.receivedAt : 0;
  const remaining = Math.max(0, Math.ceil((Date.parse(data?.sync?.nextSyncAt) - Math.max(clock, data?.receivedAt || 0) - offset) / 1000) || 0);
  const items = data?.items || [];
  const dirty = Object.keys(drafts).filter(key => key.startsWith("video:")).length;
  const matches = items.filter(item => `${item.title} ${drafts[`video:${item.id}`]?.hoverText ?? item.hoverText}`.toLowerCase().includes(search.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(matches.length / 24));
  const currentPage = Math.min(page, pageCount);
  const visible = matches.slice((currentPage - 1) * 24, currentPage * 24);
  return <AdminSection title="Videos" count={items.length} dirty={dirty}
    errors={Object.keys(errors).filter(key => key.startsWith("video:")).length + (data?.error || message ? 1 : 0)}>
    <div className="admin-video-toolbar">
      <div><strong>Hourly YouTube sync</strong><p>Last successful sync: {dateLabel(data?.fetchedAt)}</p>
        {data?.sync?.nextAutomaticAt && <p>Next automatic check: {dateLabel(data.sync.nextAutomaticAt)}</p>}</div>
      <button className="admin-submit" type="button" disabled={busy || syncing || !data?.configured || data?.sync?.inProgress || remaining > 0 || dirty > 0} onClick={onSync}>
        {syncing || data?.sync?.inProgress ? "Syncing videos…" : remaining ? `Sync available in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2,"0")}` : "Sync videos now"}
      </button>
      <button type="button" className="admin-logout" disabled={busy || syncing} onClick={onRefresh}>Refresh status</button>
    </div>
    <p className="admin-copy">Manual sync is limited to once per hour across all admins, including failed attempts. {dirty > 0 ? "Save your video edits before syncing." : "Format, visibility and hover text use Save all. YouTube identifies Videos and Shorts automatically; use Homepage shelf only to override it. Blank hover text uses the YouTube title."}</p>
    {!data?.configured && <p className="admin-row-error">YouTube is not configured or video settings have not loaded.</p>}
    {(message || data?.error) && <p className="admin-row-error" role="alert">{message || data.error}</p>}
    <label className="admin-video-search">Find a video<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search titles or hover text" /></label>
    <div className="admin-list admin-entry-grid">
      {visible.map(item => {
        const key = `video:${item.id}`, value = { ...item, ...drafts[key] };
        return <fieldset key={item.id} className={`admin-list-row admin-video-card${drafts[key] ? " admin-row-dirty" : ""}`} disabled={busy || syncing}>
          <a href={item.videoUrl} target="_blank" rel="noreferrer"><img src={item.thumbnail} alt={item.title} loading="lazy" /></a>
          <div className="admin-list-editor"><strong>{item.title}</strong><small>{dateLabel(item.publishedAt)}</small>
            <label className="admin-embed-toggle"><input type="checkbox" checked={value.hidden} onChange={event => onChange(item, { hidden: event.target.checked })} /> Hide from public feed</label>
            <label>Homepage shelf<select value={drafts[key]?.format ?? (item.formatOverride ? item.format : "auto")} onChange={event => onChange(item, { format: event.target.value })}><option value="auto">Automatic (YouTube)</option><option value="video">Videos (16:9)</option><option value="short">Shorts (9:16)</option></select></label>
            <label>Custom hover text<input type="text" maxLength={120} value={value.hoverText} placeholder={item.title} onChange={event => onChange(item, { hoverText: event.target.value })} /></label>
            <small>{value.hoverText.length}/120 · {value.hidden ? "Hidden from visitors" : "Visible in feed"}</small>
            {errors[key] && <p className="admin-row-error" role="alert">{errors[key]}</p>}
          </div>
        </fieldset>;
      })}
    </div>
    {!matches.length && <p className="admin-empty">{items.length ? "No matching videos." : "No videos cached yet. Use Sync videos now to load the channel’s public uploads."}</p>}
    {pageCount > 1 && <nav className="admin-video-pagination" aria-label="Video pages">
      <button type="button" className="admin-logout" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
      <span>Page {currentPage} of {pageCount} · {matches.length} videos</span>
      <button type="button" className="admin-logout" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button>
    </nav>}
  </AdminSection>;
}
