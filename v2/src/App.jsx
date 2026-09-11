import { useCallback, useEffect, useRef, useState } from "react";
import { staticFanart } from "./fanartManifest";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const EMAIL = "thesxberbusiness@gmail.com";

const socialLinks = [
  { href: "https://youtube.com/@thesxber", label: "YouTube", className: "youtube-theme", icon: "fa-brands fa-youtube" },
  { href: "https://www.tiktok.com/@thesxber", label: "TikTok", className: "tiktok-theme", icon: "fa-brands fa-tiktok" },
  { href: "https://instagram.com/thesxber", label: "Instagram", className: "instagram-theme", icon: "fa-brands fa-instagram" },
  { href: "https://x.com/thesxber", label: "X (Twitter)", className: "x-theme", icon: "fa-brands fa-x-twitter" },
  { href: "https://facebook.com/thesxber", label: "Facebook", className: "facebook-theme", icon: "fa-brands fa-facebook-f" },
  { href: "https://twitch.tv/thesxber", label: "Twitch", className: "twitch-theme", icon: "fa-brands fa-twitch" }
];

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function assetUrl(path) {
  return `${API_BASE}${path}`;
}

function generateDemoTiles() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: `demo-${index + 1}`,
    title: `Recent Upload / Video #${index + 1}`,
    thumbnail: `https://picsum.photos/400/400?random=${index + 1}`,
    videoUrl: "https://youtube.com"
  }));
}

function markdownToHtml(value) {
  const escaped = String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
  return escaped
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+?)\*/g, "<em>$1</em>")
    .replace(/~~([\s\S]+?)~~/g, "<s>$1</s>")
    .replace(/`([^`\n]+?)`/g, "<code>$1</code>")
    .replace(/__([\s\S]+?)__/g, "<u>$1</u>")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "<br />");
}

function MarkdownText({ value }) {
  return <span className="markdown-text" dangerouslySetInnerHTML={{ __html: markdownToHtml(value) }} />;
}

function IconButton({ icon, className = "", ...props }) {
  return (
    <button className={`switch-icon-btn ${className}`} {...props}>
      <span className="icon-inner"><i className={icon} /></span>
    </button>
  );
}

function ExternalIconLink({ href, icon, className = "", label, onMouseEnter }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`switch-icon-btn ${className}`}
      data-label={label}
      title={label}
      onMouseEnter={onMouseEnter}
    >
      <span className="icon-inner"><i className={icon} /></span>
    </a>
  );
}

function Header({ onEmail, onFanart }) {
  return (
    <header className="top-header">
      <div className="profile-shortcuts">
        <ExternalIconLink href="https://discord.gg/vefAzuUtqp" className="discord-theme" icon="fa-brands fa-discord" label="Discord" />
        <IconButton type="button" className="email-theme" title="Contact Email" aria-label="Contact Email" icon="fa-solid fa-envelope" onClick={onEmail} />
        <IconButton type="button" className="fanart-theme" title="Fanart Gallery" aria-label="Fanart Gallery" icon="fa-solid fa-palette" onClick={onFanart} />
      </div>
      <div className="top-domain">thesxber.com</div>
    </header>
  );
}

function FeedCards({ feed }) {
  if (feed.status === "loading") {
    return <div className="loading-state"><i className="fa-solid fa-spinner fa-spin" /><p>Loading Feed...</p></div>;
  }
  if (feed.status === "error") return <p className="loading-state">Error loading feed.</p>;
  if (!feed.items.length) return <p className="loading-state">No videos found.</p>;

  return feed.items.map((item) => (
    <a href={item.videoUrl} target="_blank" rel="noreferrer" className="switch-card" key={item.id}>
      <img src={item.thumbnail} alt={item.title} />
      <div className="switch-card-title">{item.title}</div>
    </a>
  ));
}

function MainCarousel() {
  const cardsViewport = useRef(null);
  const audio = useRef(null);
  const [feed, setFeed] = useState({ status: "loading", items: [] });

  useEffect(() => {
    let active = true;
    fetch(apiUrl("/api/youtube"))
      .then((response) => {
        if (!response.ok) throw new Error("Feed request failed");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        setFeed({ status: "ready", items: data.configured ? (data.items || []) : generateDemoTiles() });
      })
      .catch(() => {
        if (active) setFeed({ status: "error", items: [] });
      });
    return () => { active = false; };
  }, []);

  const playClickSound = useCallback(() => {
    if (!audio.current) return;
    audio.current.currentTime = 0;
    audio.current.play().catch(() => {});
  }, []);

  const scroll = (direction) => {
    playClickSound();
    cardsViewport.current?.scrollBy({ left: direction * 320, behavior: "smooth" });
  };

  return (
    <main className="main-carousel">
      <button className="nav-arrow left-arrow" type="button" aria-label="Scroll Left" onClick={() => scroll(-1)}><i className="fa-solid fa-chevron-left" /></button>
      <div className="cards-viewport" ref={cardsViewport}>
        <div className="cards-track"><FeedCards feed={feed} /></div>
      </div>
      <button className="nav-arrow right-arrow" type="button" aria-label="Scroll Right" onClick={() => scroll(1)}><i className="fa-solid fa-chevron-right" /></button>
      <audio ref={audio} preload="auto"><source src="/nextpageclick.mp3" type="audio/mpeg" /></audio>
    </main>
  );
}

function BottomDock() {
  const [label, setLabel] = useState("YouTube");
  return (
    <footer className="bottom-dock">
      <div className="social-dock-bar">
        <div className="dock-row">
          {socialLinks.map((link) => (
            <ExternalIconLink key={link.label} href={link.href} label={link.label} className={`${link.className} dock-btn`} icon={link.icon} onMouseEnter={() => setLabel(link.label)} />
          ))}
        </div>
      </div>
      <div className="dock-label">{label}</div>
      <div className="switch-line" />
    </footer>
  );
}

function EmailModal({ onClose }) {
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      alert("Email address copied!");
    } catch {
      alert(EMAIL);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="email-title" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-card">
        <button className="close-modal" type="button" aria-label="Close" onClick={onClose}>&times;</button>
        <i className="fa-solid fa-paper-plane modal-icon" />
        <h2 id="email-title">Contact</h2>
        <p className="email-display">{EMAIL}</p>
        <div className="modal-actions">
          <button className="action-btn" type="button" onClick={copyEmail}><i className="fa-solid fa-copy" /> Copy Address</button>
          <a href={`mailto:${EMAIL}`} className="action-btn primary"><i className="fa-solid fa-envelope-open-text" /> Send Mail</a>
        </div>
      </div>
    </div>
  );
}

function FanartModal({ onClose, onOpenLightbox }) {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    let active = true;
    fetch(apiUrl("/api/fanart"))
      .then((response) => {
        if (!response.ok) throw new Error("Fanart request failed");
        return response.json();
      })
      .then((data) => { if (active) setEntries(data.items || staticFanart); })
      .catch(() => { if (active) setEntries(staticFanart); });
    return () => { active = false; };
  }, []);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="fanart-title" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-card modal-large">
        <button className="close-modal" type="button" aria-label="Close" onClick={onClose}>&times;</button>
        <h2 id="fanart-title"><i className="fa-solid fa-palette" /> Fanart Gallery</h2>
        <div className="fanart-grid">
          {entries.map((entry) => (
            <FanartTile key={entry.filename} entry={entry} onOpenLightbox={onOpenLightbox} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <button className="close-lightbox" type="button" aria-label="Close" onClick={onClose}>&times;</button>
      <img src={src} alt="Enlarged Fanart" />
    </div>
  );
}

function tooltipPositionFor(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const maxCenterOffset = Math.min(140, Math.max(0, (window.innerWidth - 24) / 2));
  const center = Math.min(Math.max(rect.left + rect.width / 2, maxCenterOffset), window.innerWidth - maxCenterOffset);
  const placement = rect.top > 105 ? "above" : "below";
  return {
    left: center,
    top: placement === "above" ? rect.top - 10 : rect.bottom + 10,
    placement
  };
}

function FanartTile({ entry, onOpenLightbox }) {
  const tileRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const tooltipVisible = Boolean(tooltip);
  const showTooltip = () => setTooltip(tooltipPositionFor(tileRef.current));
  const hideTooltip = () => setTooltip(null);
  const label = entry.title || `Fanart ${entry.id}`;
  const hoverText = entry.hoverMarkdown?.trim() || label;

  useEffect(() => {
    if (!tooltipVisible) return undefined;
    const update = () => setTooltip(tooltipPositionFor(tileRef.current));
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [tooltipVisible]);

  return (
    <div className="fanart-tile" ref={tileRef}>
      <button
        className="fanart-tile-button"
        type="button"
        aria-label={label}
        aria-describedby={tooltip ? `fanart-hover-${entry.id}` : undefined}
        onClick={() => onOpenLightbox(assetUrl(entry.url))}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        <img src={assetUrl(entry.url)} alt={label} loading="lazy" />
      </button>
      {tooltip && (
        <div id={`fanart-hover-${entry.id}`} className="fanart-hover-tag" data-placement={tooltip.placement} role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
          <MarkdownText value={hoverText} />
        </div>
      )}
    </div>
  );
}

function FanartAdminRow({ entry, onRemove, onSaved }) {
  const [title, setTitle] = useState(entry.title || "");
  const [hoverMarkdown, setHoverMarkdown] = useState(entry.hoverMarkdown || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(entry.title || "");
    setHoverMarkdown(entry.hoverMarkdown || "");
  }, [entry.title, entry.hoverMarkdown]);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiUrl("/api/admin/fanart")}/${encodeURIComponent(entry.filename)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, hoverMarkdown })
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error("Your Discord login has expired. Sign in again.");
      if (!response.ok) throw new Error(data.error || "Unable to save fanart details.");
      onSaved(data.item);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-list-row">
      <img src={assetUrl(entry.originalUrl || entry.url)} alt="" />
      <div className="admin-list-editor">
        <strong className="admin-list-filename">{entry.filename}</strong>
        <label>Title<input type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></label>
        <label>Hover Markdown<textarea value={hoverMarkdown} onChange={(event) => setHoverMarkdown(event.target.value)} maxLength={2000} placeholder="**Artist name**\n*Optional note*" /></label>
        <p className="admin-markdown-help">Supports **bold**, *italic*, ~~strike~~, `code`, and __underline__.</p>
        {error && <p className="admin-row-error" role="alert">{error}</p>}
        <div className="admin-list-actions">
          <button type="button" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
          <button type="button" onClick={() => onRemove(entry.filename)}>Remove</button>
        </div>
      </div>
    </div>
  );
}

function Site() {
  const [emailOpen, setEmailOpen] = useState(false);
  const [fanartOpen, setFanartOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState("");

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setEmailOpen(false);
      setFanartOpen(false);
      setLightboxSrc("");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <div className="switch-screen">
      <Header onEmail={() => setEmailOpen(true)} onFanart={() => setFanartOpen(true)} />
      <MainCarousel />
      <BottomDock />
      {emailOpen && <EmailModal onClose={() => setEmailOpen(false)} />}
      {fanartOpen && <FanartModal onClose={() => setFanartOpen(false)} onOpenLightbox={setLightboxSrc} />}
      <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc("")} />
    </div>
  );
}

function formatActivityAction(action = "") {
  return action.replace(/^auth\./, "").replace(/^fanart\./, "fanart ").replaceAll(".", " ");
}

function formatActivityTime(value) {
  if (!value) return "—";
  try { return new Date(value).toLocaleString(); } catch { return String(value); }
}

function AdminPage() {
  const [user, setUser] = useState(null);
  const [title, setTitle] = useState("");
  const [hoverMarkdown, setHoverMarkdown] = useState("");
  const [file, setFile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [activity, setActivity] = useState([]);
  const [adminReady, setAdminReady] = useState(false);
  const [message, setMessage] = useState("Checking Discord session…");

  const loadEntries = useCallback(async () => {
    const response = await fetch(apiUrl("/api/fanart"), { credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The fanart API is unavailable.");
    setEntries(data.items || []);
  }, []);

  const loadActivity = useCallback(async () => {
    const response = await fetch(apiUrl("/api/admin/activity?limit=100"), { credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      setUser(null);
      throw new Error("Your Discord login has expired. Sign in again.");
    }
    if (!response.ok) throw new Error(data.error || "The activity ledger is unavailable.");
    setActivity(data.items || []);
  }, []);

  const loadDashboard = useCallback(async () => {
    await Promise.all([loadEntries(), loadActivity()]);
  }, [loadActivity, loadEntries]);

  useEffect(() => {
    let active = true;
    const authStatus = new URLSearchParams(window.location.search).get("auth");
    const callbackMessage = {
      success: "Signed in with Discord.",
      denied: "That Discord account is not on the allowed admin list.",
      error: "Discord login could not be completed.",
      unconfigured: "Discord login is not configured on the backend."
    }[authStatus] || "";
    if (authStatus) window.history.replaceState({}, document.title, window.location.pathname);

    fetch(apiUrl("/api/auth/session"), { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("The Discord session check failed.");
        return response.json();
      })
      .then((result) => {
        if (!active || !result) return;
        setAdminReady(true);
        setUser(result.user || null);
        if (result.authenticated) {
          loadDashboard().catch((error) => { if (active) setMessage(error.message); });
          if (callbackMessage) setMessage(callbackMessage);
        } else {
          setMessage(callbackMessage || "Sign in with Discord to manage fanart and view the activity ledger.");
        }
      })
      .catch((error) => {
        if (active) setMessage(error.message || "The Discord session check failed.");
      });
    return () => { active = false; };
  }, [loadDashboard]);

  const login = () => { window.location.assign(apiUrl("/api/auth/discord")); };

  const logout = async () => {
    setMessage("Signing out…");
    try {
      const response = await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to sign out.");
      setUser(null);
      setEntries([]);
      setActivity([]);
      setMessage("Signed out.");
    } catch (error) { setMessage(error.message); }
  };

  const upload = async (event) => {
    event.preventDefault();
    if (!file) { setMessage("Choose an image to upload."); return; }
    const formData = new FormData();
    formData.append("file", file);
    if (title.trim()) formData.append("title", title.trim());
    if (hoverMarkdown.trim()) formData.append("hoverMarkdown", hoverMarkdown.trim());
    setMessage("Uploading…");
    try {
      const response = await fetch(apiUrl("/api/admin/fanart"), { method: "POST", credentials: "include", body: formData });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setUser(null); throw new Error("Your Discord login has expired. Sign in again."); }
      if (!response.ok) throw new Error(data.error || "Upload failed");
      setFile(null);
      setTitle("");
      setHoverMarkdown("");
      event.target.reset();
      setMessage(`Uploaded ${data.item.filename}.`);
      await loadDashboard();
    } catch (error) { setMessage(error.message); }
  };

  const remove = async (filename) => {
    setMessage(`Removing ${filename}…`);
    try {
      const response = await fetch(`${apiUrl("/api/admin/fanart")}/${encodeURIComponent(filename)}`, { method: "DELETE", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setUser(null); throw new Error("Your Discord login has expired. Sign in again."); }
      if (!response.ok) throw new Error(data.error || "Remove failed");
      setMessage(`Removed ${filename}.`);
      await loadDashboard();
    } catch (error) { setMessage(error.message); }
  };

  if (!adminReady) {
    return (
      <main className="admin-page">
        <section className="admin-card"><p className="admin-message" aria-live="polite">{message}</p></section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="admin-page">
        <section className="admin-card admin-login-card">
          <a className="admin-back" href="/">← Back to thesxber.com</a>
          <p className="admin-eyebrow">thesxber.com / v2</p>
          <i className="fa-brands fa-discord admin-login-icon" aria-hidden="true" />
          <h1>Admin sign in</h1>
          <p className="admin-copy">Use your Discord account to access fanart tools. Only Discord IDs listed in the private allowlist can continue.</p>
          <button className="admin-discord" type="button" onClick={login}><i className="fa-brands fa-discord" /> Continue with Discord</button>
          <p className="admin-message" aria-live="polite">{message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <section className="admin-card">
        <div className="admin-toolbar">
          <a className="admin-back" href="/">← Back to thesxber.com</a>
          <button className="admin-logout" type="button" onClick={logout}>Sign out</button>
        </div>
        <div className="admin-user">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <i className="fa-brands fa-discord" aria-hidden="true" />}
          <div><strong>{user.displayName || user.username}</strong><span>@{user.username}</span></div>
        </div>
        <p className="admin-eyebrow">thesxber.com / v2</p>
        <h1>Fanart admin</h1>
        <p className="admin-copy">You are signed in with Discord. Uploads, edits, and removals are recorded in the activity ledger, and the restricted fanart commands use the same audit trail.</p>
        <form className="admin-form" onSubmit={upload}>
          <label>Fanart image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
          <label>Optional title<input type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></label>
          <label>Hover Markdown<textarea value={hoverMarkdown} onChange={(event) => setHoverMarkdown(event.target.value)} maxLength={2000} placeholder="**Artist name**\n*Optional note*" /></label>
          <p className="admin-markdown-help">Supports **bold**, *italic*, ~~strike~~, `code`, and __underline__.</p>
          <button className="admin-submit" type="submit">Upload fanart</button>
        </form>
        <p className="admin-message" aria-live="polite">{message}</p>
        <div className="admin-list">
          {entries.map((entry) => (
            <FanartAdminRow
              key={entry.filename}
              entry={entry}
              onRemove={remove}
              onSaved={(updated) => setEntries((current) => current.map((item) => item.filename === updated.filename ? updated : item))}
            />
          ))}
        </div>
        <section className="admin-ledger" aria-labelledby="activity-title">
          <div className="admin-ledger-heading"><h2 id="activity-title">Activity ledger</h2><button type="button" onClick={() => loadDashboard().catch((error) => setMessage(error.message))}>Refresh</button></div>
          {activity.length ? (
            <div className="admin-ledger-scroll">
              <table className="admin-ledger-table">
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
                <tbody>{activity.map((entry) => <tr key={entry.id}><td>{formatActivityTime(entry.createdAt)}</td><td><span className="admin-ledger-user">{entry.discordUsername}<small>{entry.discordUserId}</small></span></td><td>{formatActivityAction(entry.action)}</td><td>{entry.resourceId || "—"}</td><td>{entry.ipAddress || "—"}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="admin-empty">No activity has been recorded yet.</p>}
        </section>
      </section>
    </main>
  );
}

export default function App() {
  return window.location.pathname.replace(/\/$/, "") === "/admin" ? <AdminPage /> : <Site />;
}
