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
            <img key={entry.filename} src={assetUrl(entry.url)} alt={entry.title || `Fanart ${entry.id}`} onClick={() => onOpenLightbox(assetUrl(entry.url))} />
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

function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem("sxber-admin-token") || "");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [adminReady, setAdminReady] = useState(false);
  const [message, setMessage] = useState("Checking admin access…");

  const loadEntries = useCallback(async () => {
    try {
      const response = await fetch(apiUrl("/api/fanart"));
      const data = await response.json();
      setEntries(data.items || []);
      setMessage("");
    } catch {
      setMessage("The fanart API is unavailable.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch(apiUrl("/api/admin/access"))
      .then((response) => {
        if (response.status === 403) {
          window.location.replace("/");
          return null;
        }
        if (!response.ok) throw new Error("The admin access check failed.");
        return response.json();
      })
      .then((result) => {
        if (!active || !result) return;
        setAdminReady(true);
        loadEntries();
      })
      .catch((error) => {
        if (active) setMessage(error.message || "The admin access check failed.");
      });
    return () => { active = false; };
  }, [loadEntries]);

  const upload = async (event) => {
    event.preventDefault();
    if (!file || !token) { setMessage("Choose an image and enter the admin token."); return; }
    const formData = new FormData();
    formData.append("file", file);
    if (title.trim()) formData.append("title", title.trim());
    setMessage("Uploading…");
    try {
      const response = await fetch(apiUrl("/api/admin/fanart"), { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");
      sessionStorage.setItem("sxber-admin-token", token);
      setFile(null);
      setTitle("");
      event.target.reset();
      setMessage(`Uploaded ${data.item.filename}.`);
      loadEntries();
    } catch (error) { setMessage(error.message); }
  };

  const remove = async (filename) => {
    if (!token) { setMessage("Enter the admin token first."); return; }
    const response = await fetch(`${apiUrl("/api/admin/fanart")}/${encodeURIComponent(filename)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    setMessage(response.ok ? `Removed ${filename}.` : (data.error || "Remove failed"));
    if (response.ok) loadEntries();
  };

  if (!adminReady) {
    return (
      <main className="admin-page">
        <section className="admin-card"><p className="admin-message" aria-live="polite">{message}</p></section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <section className="admin-card">
        <a className="admin-back" href="/">← Back to thesxber.com</a>
        <p className="admin-eyebrow">thesxber.com / v2</p>
        <h1>Fanart admin</h1>
        <p className="admin-copy">Uploads can be made here with the server admin token or directly with the restricted Discord <code>/fanart-upload</code> command.</p>
        <form className="admin-form" onSubmit={upload}>
          <label>Admin token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" /></label>
          <label>Fanart image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
          <label>Optional title<input type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></label>
          <button className="admin-submit" type="submit">Upload fanart</button>
        </form>
        <p className="admin-message" aria-live="polite">{message}</p>
        <div className="admin-list">
          {entries.map((entry) => (
            <div className="admin-list-row" key={entry.filename}>
              <img src={assetUrl(entry.url)} alt="" />
              <span>{entry.filename}</span>
              <button type="button" onClick={() => remove(entry.filename)}>Remove</button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default function App() {
  return window.location.pathname.replace(/\/$/, "") === "/admin" ? <AdminPage /> : <Site />;
}
