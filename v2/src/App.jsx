import { useCallback, useEffect, useRef, useState } from "react";
import SiteCredit, { PublicAtmosphere } from "./SiteCredit";
import EmojiAdminSection, { updateEmojiDraft } from "./EmojiAdminSection";
import AdminSection from "./AdminSection";
import LiveAdminSection, { updateLiveDraft } from "./LiveAdminSection";
import VideoAdminSection from "./VideoAdminSection";
import FanartPage from "./FanartPage";
import MediaFeed from "./MediaFeed";
import FooterDetails from "./FooterDetails";
import BannerCropEditor from "./BannerCropEditor";
import { updateFanartDraft } from "./fanart-drafts.js";
import SxbertyPet, { useSxbertyPet } from "./SxbertyPet";
import SxbertyAdminSection from "./SxbertyAdminSection";
import { updateSxbertyDraft } from "./sxberty-drafts.js";
import { validateSxbertyPatch } from "../shared/sxberty.js";
import { validateSxbertyFoodPatch } from "../shared/sxberty-foods.js";
import { sxbertyFoodDraftKey, updateSxbertyFoodDraft } from "./sxberty-food-drafts.js";

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

function Header({ onEmail, onDomain, petUnlocked }) {
  return (
    <header className="top-header">
      <div className="profile-shortcuts">
        <ExternalIconLink href="https://discord.gg/vefAzuUtqp" className="discord-theme" icon="fa-brands fa-discord" label="Discord" />
        <IconButton type="button" className="email-theme" title="Contact Email" aria-label="Contact Email" icon="fa-solid fa-envelope" onClick={onEmail} />
        <a href="/fanart" className="switch-icon-btn fanart-theme" title="Fanart Gallery" aria-label="Fanart Gallery"><span className="icon-inner"><i className="fa-solid fa-palette" /></span></a>
      </div>
      <button type="button" className="top-domain" onClick={onDomain} aria-label={petUnlocked ? "thesxber.com — Visit Sxberty" : "thesxber.com"}>thesxber.com</button>

    </header>
  );
}
function LiveStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let active = true;
    const load = () => fetch(apiUrl("/api/live")).then(response => response.ok ? response.json() : null).then(data => { if (active && data) setStatus(data); }).catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const providers = status ? ["tiktok"].map(key => ({ key, ...status[key] })).filter(item => item.configured) : [];
  if (!providers.length) return null;
  return <div className="live-status" aria-label="Live status">
    {providers.map(provider => <a key={provider.key} href={provider.url} target="_blank" rel="noreferrer" className={provider.live ? "is-live" : ""}>
      <span className="live-status-dot" aria-hidden="true" />{provider.key === "twitch" ? "Twitch" : "TikTok"}{provider.live ? " LIVE" : ""}
      {provider.live && provider.title ? <span className="live-status-title"> — {provider.title}</span> : null}
    </a>)}
  </div>;
}

function BottomDock() {
  return (
    <footer className="bottom-dock">
      <div className="social-dock-bar">
        <div className="dock-row">
          {socialLinks.map((link) => (
            <ExternalIconLink key={link.label} href={link.href} label={link.label} className={`${link.className} dock-btn`} icon={link.icon} />
          ))}
        </div>
      </div>
      <LiveStatus />
      <SiteCredit />
      <div className="switch-line" />
      <FooterDetails email={EMAIL} />
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

function FanartAdminRow({ entry, draft = {}, onChange, onRemove, busy, error }) {
  const [cropOpen, setCropOpen] = useState(false);
  const value = { ...entry, ...draft };
  const dirty = Object.keys(draft).length > 0;
  return (
    <fieldset className={`admin-list-row${dirty ? " admin-row-dirty" : ""}`} disabled={busy}>
      {cropOpen && <BannerCropEditor entry={value}
        sourceUrl={`${apiUrl("/api/admin/fanart")}/${encodeURIComponent(entry.filename)}/crop-source`}
        onClose={() => setCropOpen(false)} onSave={(crop) => onChange({ embedCrop: crop })} />}
      <img src={assetUrl(entry.originalUrl || entry.url)} alt="" loading="lazy" />
      <div className="admin-list-editor">
        <strong className="admin-list-filename">{entry.filename}{dirty && <span className="admin-draft-label">Unsaved</span>}</strong>
        <label className="admin-embed-toggle"><input type="checkbox" checked={value.embedEligible === true} onChange={(event) => onChange({ embedEligible: event.target.checked })} /> Include in hourly embed rotation</label>
        <div className="admin-list-actions"><button type="button" onClick={() => setCropOpen(true)}>Crop embed banner</button>
          <span className="admin-crop-status">{Object.hasOwn(draft, "embedCrop") ? "Crop ready to save" : value.embedCrop ? "Custom crop" : "Automatic crop"}</span></div>
        <label>Title<input type="text" value={value.title || ""} onChange={(event) => onChange({ title: event.target.value })} maxLength={120} /></label>
        <label>Description (Markdown)<textarea value={value.hoverMarkdown || ""} onChange={(event) => onChange({ hoverMarkdown: event.target.value })} maxLength={100} placeholder="A short note about the artwork" /></label>
        <small className="admin-character-count">{(value.hoverMarkdown || "").length}/100</small>
        <label>Artist credit link<input type="url" value={value.creditUrl || ""} onChange={(event) => onChange({ creditUrl: event.target.value })} maxLength={2048} placeholder="https://x.com/artist" /></label>
        <p className="admin-markdown-help">The hover shows the title and links to the artist. The description appears when the artwork is opened.</p>
        {error && <p className="admin-row-error" role="alert">{error}</p>}
        <div className="admin-list-actions"><button type="button" onClick={() => onRemove(entry.filename)}>Remove</button></div>
      </div>
    </fieldset>
  );
}

function Site() {
  const [emailOpen, setEmailOpen] = useState(false);
  const sxberty = useSxbertyPet({ blocked: emailOpen });

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setEmailOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return (
    <div className="switch-screen homepage-screen">
      <Header onEmail={() => setEmailOpen(true)} onDomain={sxberty.visit} petUnlocked={Boolean(sxberty.pet)} />
      <MediaFeed />
      <BottomDock />
      {emailOpen && <EmailModal onClose={() => setEmailOpen(false)} />}
      <SxbertyPet {...sxberty} blocked={emailOpen} />
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
  const [creditUrl, setCreditUrl] = useState("");
  const [drafts, setDrafts] = useState({});
  const [saveErrors, setSaveErrors] = useState({});
  const [savingAll, setSavingAll] = useState(false);
  const dirtyCount = Object.keys(drafts).length;
  const [file, setFile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [emojis, setEmojis] = useState([]);
  const [emojiSettings, setEmojiSettings] = useState(null);
  const [videos, setVideos] = useState(null);
  const [liveData, setLiveData] = useState(null);
  const [sxbertySettings, setSxbertySettings] = useState(null);
  const [sxbertyLoading, setSxbertyLoading] = useState(false);
  const [sxbertyLoadError, setSxbertyLoadError] = useState("");
  const sxbertyLoadVersion = useRef(0);
  const [sxbertyFoods, setSxbertyFoods] = useState(null);
  const [foodLoading, setFoodLoading] = useState(false);
  const [foodLoadError, setFoodLoadError] = useState("");
  const [foodBusy, setFoodBusy] = useState(false);
  const [foodActionError, setFoodActionError] = useState("");
  const [foodMessage, setFoodMessage] = useState("");
  const foodLoadVersion = useRef(0);
  const foodMutationActive = useRef(false);
  const [syncingVideos, setSyncingVideos] = useState(false);
  const [videoMessage, setVideoMessage] = useState("");
  const [activity, setActivity] = useState([]);
  const [adminReady, setAdminReady] = useState(false);
  const [message, setMessage] = useState("Checking Discord session…");

  useEffect(() => {
    if (!dirtyCount) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  const changeEntry = (entry, changes) => {
    setDrafts(current => {
      const next = { ...current };
      const draft = updateFanartDraft(entry, current[entry.filename], changes);
      if (Object.keys(draft).length) next[entry.filename] = draft;
      else delete next[entry.filename];
      return next;
    });
    setSaveErrors(current => { const next = { ...current }; delete next[entry.filename]; return next; });
  };

  const changeEmojiSettings = (count) => {
    setDrafts(current => {
      const next = { ...current };
      if (count === emojiSettings?.count) delete next["emoji-settings"];
      else next["emoji-settings"] = { count };
      return next;
    });
    setSaveErrors(current => { const next = { ...current }; delete next["emoji-settings"]; return next; });
  };
  const changeEmoji = (entry, changes) => {
    const key = `emoji:${entry.id}`;
    setDrafts(current => {
      const next = { ...current }, draft = updateEmojiDraft(entry, current[key], changes);
      if (Object.keys(draft).length) next[key] = draft; else delete next[key];
      return next;
    });
    setSaveErrors(current => { const next = { ...current }; delete next[key]; return next; });
  };
  const removeEmoji = async (entry) => {
    try {
      const response = await fetch(apiUrl(`/api/admin/emojis/${entry.id}`), { method: "DELETE", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to remove emoji");
      setEmojis(current => current.filter(item => item.id !== entry.id));
      const key = `emoji:${entry.id}`;
      setDrafts(current => { const next = { ...current }; delete next[key]; return next; });
      setSaveErrors(current => { const next = { ...current }; delete next[key]; return next; });
      setMessage(`Removed ${entry.name}.`); loadActivity().catch(() => {});
    } catch (error) { setMessage(error.message); }
  };

  const changeVideo = (entry, changes) => {
    const key = `video:${entry.id}`;
    setDrafts(current => {
      const baseline = { ...entry, format: entry.formatOverride ? entry.format : "auto" };
      const next = { ...current }, draft = updateEmojiDraft(baseline, current[key], changes);
      if (Object.keys(draft).length) next[key] = draft; else delete next[key];
      return next;
    });
    setSaveErrors(current => { const next = { ...current }; delete next[key]; return next; });
  };
  const changeLive = (changes) => {
    const key = "live";
    setDrafts(current => {
      const next = { ...current };
      const draft = updateLiveDraft(liveData, current[key], changes);
      if (Object.keys(draft).length) next[key] = draft; else delete next[key];
      return next;
    });
    setSaveErrors(current => { const next = { ...current }; delete next[key]; return next; });
  };
  const changeSxberty = (phaseId, phrases) => {
    setDrafts(current => {
      const next = { ...current };
      const draft = updateSxbertyDraft(sxbertySettings, current.sxberty, phaseId, phrases);
      if (Object.keys(draft).length) next.sxberty = draft; else delete next.sxberty;
      return next;
    });
    setSaveErrors(current => { const next = { ...current }; delete next.sxberty; return next; });
  };

  const changeFood = (entry, changes) => {
    const key = sxbertyFoodDraftKey(entry.id);
    setDrafts(current => {
      const next = { ...current }, draft = updateSxbertyFoodDraft(entry, current[key], changes);
      if (Object.keys(draft).length) next[key] = draft; else delete next[key];
      return next;
    });
    setSaveErrors(current => { const next = { ...current }; delete next[key]; return next; });
  };
  const invalidateFoodLoad = () => {
    foodLoadVersion.current++;
    setFoodLoading(false);
  };
  const mutateFood = async (method, entry, formData) => {
    if (savingAll || foodMutationActive.current) return false;
    foodMutationActive.current = true;
    setFoodBusy(true);
    setFoodActionError("");
    setFoodMessage(method === "POST" ? "Uploading food…" : "Removing food…");
    invalidateFoodLoad();
    try {
      const endpoint = `/api/admin/sxberty-foods${entry ? `/${encodeURIComponent(entry.id)}` : ""}`;
      const response = await fetch(apiUrl(endpoint), { method, credentials: "include", ...(formData ? { body: formData } : {}) });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error("Your Discord login has expired. Sign in again.");
      if (!response.ok) throw new Error(data.error || "Unable to update Sxberty foods.");
      if (method === "POST" && !data.item) throw new Error("The uploaded food was not returned. Retry loading foods.");
      invalidateFoodLoad();
      setFoodLoadError("");
      if (method === "POST") {
        setSxbertyFoods(current => [...(current || []).filter(item => item.id !== data.item.id), data.item]);
        setFoodMessage(`Uploaded ${data.item.name}. Food is ${data.item.enabled ? "enabled" : "disabled"}.`);
      } else {
        setSxbertyFoods(current => (current || []).filter(item => item.id !== entry.id));
        const key = sxbertyFoodDraftKey(entry.id);
        setDrafts(current => { const next = { ...current }; delete next[key]; return next; });
        setSaveErrors(current => { const next = { ...current }; delete next[key]; return next; });
        setFoodMessage(`Removed ${entry.name}.`);
      }
      loadActivity().catch(() => {});
      return true;
    } catch (error) {
      setFoodMessage("");
      setFoodActionError(error.message);
      return false;
    } finally {
      foodMutationActive.current = false;
      setFoodBusy(false);
    }
  };

  const saveAll = async () => {
    if (savingAll || foodMutationActive.current || !dirtyCount) return;
    setSavingAll(true);
    setSaveErrors({});
    const failures = {};
    let saved = 0;
    for (const [filename, draft] of Object.entries(drafts)) {
      try {
        const emoji = filename.startsWith("emoji:");
        const live = filename === "live";
        const sxberty = filename === "sxberty";
        const food = filename.startsWith("sxberty-food:");
        const video = filename.startsWith("video:");
        const settings = filename === "emoji-settings";
        const endpoint = food ? `/api/admin/sxberty-foods/${encodeURIComponent(filename.slice(13))}` : sxberty ? "/api/admin/sxberty" : live ? "/api/admin/live" : settings ? "/api/admin/emoji-settings" : video ? `/api/admin/videos/${encodeURIComponent(filename.slice(6))}` : emoji ? `/api/admin/emojis/${filename.slice(6)}` : `/api/admin/fanart/${encodeURIComponent(filename)}`;
        const body = food ? validateSxbertyFoodPatch(draft) : sxberty ? validateSxbertyPatch(draft) : draft;
        if (food) invalidateFoodLoad();
        const response = await fetch(apiUrl(endpoint), {
          method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) throw new Error("Your Discord login has expired. Sign in again to save these drafts.");
        if (!response.ok) throw new Error(data.error || "Unable to save this item. Try again.");
        if (food) {
          if (!data.item) throw new Error("The saved food was not returned. Retry Save all.");
          invalidateFoodLoad();
          setFoodLoadError("");
          setSxbertyFoods(current => (current || []).map(entry => entry.id === filename.slice(13) ? data.item : entry));
        } else if (sxberty) {
          if (!data.settings) throw new Error("The saved Sxberty settings were not returned. Retry Save all.");
          sxbertyLoadVersion.current++;
          setSxbertyLoading(false);
          setSxbertyLoadError("");
          setSxbertySettings(data.settings);
        } else if (live) setLiveData(data);
        else if (settings) setEmojiSettings(data.settings);
        else if (video) setVideos(current => ({ ...current, items: current.items.map(entry => entry.id === filename.slice(6) ? data.item : entry) }));
        else if (emoji) setEmojis(current => current.map(entry => entry.id === filename.slice(6) ? data.item : entry));
        else setEntries(current => current.map(entry => entry.filename === filename ? data.item : entry));
        setDrafts(current => { const next = { ...current }; delete next[filename]; return next; });
        saved++;
      } catch (error) { failures[filename] = error.message; }
    }
    setSaveErrors(failures);
    setSavingAll(false);
    setMessage(Object.keys(failures).length ? `${saved} saved. Unsaved entries are kept below; fix any errors and retry Save all.` : `Saved all changes (${saved} ${saved === 1 ? "item" : "items"}).`);
    loadActivity().catch(() => {});
  };

  const loadEntries = useCallback(async () => {
    const response = await fetch(apiUrl("/api/admin/fanart"), { credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The fanart API is unavailable.");
    setEntries(data.items || []);
  }, []);

  const loadActivity = useCallback(async () => {
    const response = await fetch(apiUrl("/api/admin/activity?limit=100"), { credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      throw new Error("Your Discord login has expired. Sign in again.");
    }
    if (!response.ok) throw new Error(data.error || "The activity ledger is unavailable.");
    setActivity(data.items || []);
  }, []);
  const loadLive = useCallback(async () => {
    const response = await fetch(apiUrl("/api/admin/live"), { credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 401 ? "Your Discord login has expired. Sign in again." : data.error || "Unable to load live tracking");
    setLiveData(data);
  }, []);

  const loadSxberty = useCallback(async () => {
    const version = ++sxbertyLoadVersion.current;
    setSxbertyLoading(true);
    setSxbertyLoadError("");
    try {
      const response = await fetch(apiUrl("/api/admin/sxberty"), { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 401 ? "Your Discord login has expired. Sign in again." : data.error || "Unable to load Sxberty phrases.");
      if (!data.settings) throw new Error("Sxberty settings are unavailable. Please retry.");
      if (version === sxbertyLoadVersion.current) setSxbertySettings(data.settings);
    } catch (error) {
      if (version === sxbertyLoadVersion.current) setSxbertyLoadError(error.message);
    } finally {
      if (version === sxbertyLoadVersion.current) setSxbertyLoading(false);
    }
  }, []);

  const loadSxbertyFoods = useCallback(async () => {
    const version = ++foodLoadVersion.current;
    setFoodLoading(true);
    setFoodLoadError("");
    try {
      const response = await fetch(apiUrl("/api/admin/sxberty-foods"), { credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 401 ? "Your Discord login has expired. Sign in again." : data.error || "Unable to load Sxberty foods.");
      if (!Array.isArray(data.items)) throw new Error("The food catalog is unavailable. Please retry.");
      if (version === foodLoadVersion.current) setSxbertyFoods(data.items);
    } catch (error) {
      if (version === foodLoadVersion.current) setFoodLoadError(error.message);
    } finally {
      if (version === foodLoadVersion.current) setFoodLoading(false);
    }
  }, []);

  const loadEmojis = useCallback(async () => {
    const response = await fetch(apiUrl("/api/admin/emojis"), { credentials: "include" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load emojis");
    setEmojis(data.items || []);
    setEmojiSettings(data.settings || { count: 10 });
  }, []);
  const loadVideos = useCallback(async (statusOnly = false) => {
    const response = await fetch(apiUrl("/api/admin/videos"), { credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 401 ? "Your Discord login has expired. Sign in again." : data.error || "Unable to load videos");
    setVideos(current => ({ ...data, receivedAt: Date.now(), items: statusOnly && current ? current.items : data.items }));
  }, []);
  const refreshVideoStatus = () => { setVideoMessage(""); loadVideos(true).catch(error => setVideoMessage(error.message)); };
  useEffect(() => {
    if (!videos?.sync?.inProgress || syncingVideos) return;
    const timer = setInterval(() => { loadVideos(true).catch(error => setVideoMessage(error.message)); }, 5000);
    return () => clearInterval(timer);
  }, [videos?.sync?.inProgress, syncingVideos, loadVideos]);
  const syncVideos = async () => {
    if (syncingVideos || savingAll) return;
    setSyncingVideos(true);
    setVideoMessage("");
    try {
      const response = await fetch(apiUrl("/api/admin/videos/sync"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 401 ? "Your Discord login has expired. Sign in again." : data.error || "Unable to sync videos");
      setVideos({ ...data, receivedAt: Date.now() });
      setMessage(`Synced ${data.items.length} videos.`);
    } catch (error) {
      setVideoMessage(error.message);
      await loadVideos(true).catch(() => {});
    } finally {
      setSyncingVideos(false);
      loadActivity().catch(() => {});
    }
  };
  const loadDashboard = useCallback(async () => {
    await Promise.all([loadEntries(), loadActivity(), loadEmojis(), loadVideos(), loadLive(), loadSxberty(), loadSxbertyFoods()]);
  }, [loadActivity, loadEntries, loadEmojis, loadLive, loadVideos, loadSxberty, loadSxbertyFoods]);

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
          setMessage(callbackMessage || "");
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
    if (dirtyCount && !window.confirm("Discard unsaved changes and sign out?")) return;
    setMessage("Signing out…");
    try {
      const response = await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Unable to sign out.");
      setUser(null);
      setEntries([]);
      setEmojis([]);
      setEmojiSettings(null);
      setVideos(null);
      setLiveData(null);
      sxbertyLoadVersion.current++;
      setSxbertySettings(null);
      setSxbertyLoading(false);
      setSxbertyLoadError("");
      foodLoadVersion.current++;
      setSxbertyFoods(null);
      setFoodLoading(false);
      setFoodLoadError("");
      setFoodActionError("");
      setFoodMessage("");
      setVideoMessage("");
      setDrafts({});
      setSaveErrors({});
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
    if (creditUrl.trim()) formData.append("creditUrl", creditUrl.trim());
    setMessage("Uploading…");
    try {
      const response = await fetch(apiUrl("/api/admin/fanart"), { method: "POST", credentials: "include", body: formData });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setUser(null); throw new Error("Your Discord login has expired. Sign in again."); }
      if (!response.ok) throw new Error(data.error || "Upload failed");
      setFile(null);
      setTitle("");
      setHoverMarkdown("");
      setCreditUrl("");
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
      setDrafts(current => { const next = { ...current }; delete next[filename]; return next; });
      setSaveErrors(current => { const next = { ...current }; delete next[filename]; return next; });
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
      <section className="admin-card admin-dashboard">
        <div className="admin-toolbar">
          <a className="admin-back" href="/">← Back to thesxber.com</a>
          <button className="admin-logout" type="button" onClick={logout} disabled={savingAll || foodBusy}>Sign out</button>
        </div>
        <div className="admin-user">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <i className="fa-brands fa-discord" aria-hidden="true" />}
          <div><strong>{user.displayName || user.username}</strong><span>@{user.username}</span></div>
        </div>
        <p className="admin-eyebrow">thesxber.com / v2</p>
        <h1>Site admin</h1>
        <p className="admin-copy">You are signed in with Discord. Uploads, edits, and removals are recorded in the activity ledger, and the restricted fanart commands use the same audit trail.</p>
        <p className="admin-message" aria-live="polite">{message}</p>
        <div className="admin-sections">
        <VideoAdminSection data={videos} drafts={drafts} errors={saveErrors} busy={savingAll} syncing={syncingVideos}
          message={videoMessage} onSync={syncVideos} onRefresh={refreshVideoStatus} onChange={changeVideo} />
        <LiveAdminSection data={liveData} draft={drafts.live} error={saveErrors.live} busy={savingAll} onChange={changeLive} />
        <SxbertyAdminSection settings={sxbertySettings} draft={drafts.sxberty} error={saveErrors.sxberty}
          loading={sxbertyLoading} loadError={sxbertyLoadError} busy={savingAll || foodBusy}
          onChange={changeSxberty} onRetry={loadSxberty}
          foods={{ items: sxbertyFoods || [], drafts, errors: saveErrors, loading: foodLoading,
            loadError: foodLoadError, actionError: foodActionError, message: foodMessage,
            ready: sxbertyFoods !== null, apiBase: API_BASE, onRetry: loadSxbertyFoods,
            onChange: changeFood, onUpload: formData => mutateFood("POST", null, formData),
            onRemove: entry => mutateFood("DELETE", entry) }} />
        <AdminSection title="Upload fanart">
        <form className="admin-form" onSubmit={upload}>
          <fieldset className="admin-upload-fields" disabled={savingAll}>
          <label>Fanart image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
          <label>Optional title<input type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></label>
          <label>Description (Markdown)<textarea value={hoverMarkdown} onChange={(event) => setHoverMarkdown(event.target.value)} maxLength={100} placeholder="A short note about the artwork" /></label>
          <small className="admin-character-count">{hoverMarkdown.length}/100</small>
          <label>Artist credit link<input type="url" value={creditUrl} onChange={(event) => setCreditUrl(event.target.value)} maxLength={2048} placeholder="https://x.com/artist" /></label>
          <p className="admin-markdown-help">Supports **bold**, *italic*, ~~strike~~, `code`, and __underline__.</p>
          <button className="admin-submit" type="submit">Upload fanart</button>
          </fieldset>
        </form>
        </AdminSection>
        <AdminSection title="Fanart library" count={entries.length}
          dirty={entries.filter(entry => drafts[entry.filename]).length}
          errors={entries.filter(entry => saveErrors[entry.filename]).length}>
        <p className="admin-copy">Edit any entries, then use Save all to publish your changes. The banner rotates every hour and is cropped to 4:1. <a className="admin-back" href={apiUrl("/artoftheday.webp")} target="_blank" rel="noreferrer">View current banner ↗</a></p>
        <div className="admin-list admin-entry-grid">
          {entries.map((entry) => (
            <FanartAdminRow
              key={entry.filename}
              entry={entry}
              onRemove={remove}
              draft={drafts[entry.filename]}
              onChange={(changes) => changeEntry(entry, changes)}
              busy={savingAll}
              error={saveErrors[entry.filename]}
            />
          ))}
        </div>
        </AdminSection>
        <EmojiAdminSection items={emojis} drafts={drafts} errors={saveErrors} busy={savingAll}
          settings={emojiSettings} onSettingsChange={changeEmojiSettings}
          onChange={changeEmoji} onRemove={removeEmoji}
          onUploaded={item => { setEmojis(current => [...current, item]); loadActivity().catch(() => {}); }} />
        <AdminSection title="Activity ledger" count={activity.length}>
          <div className="admin-ledger-heading"><h2 id="activity-title">Activity ledger</h2><button type="button" disabled={savingAll} onClick={() => loadActivity().catch((error) => setMessage(error.message))}>Refresh</button></div>
          {activity.length ? (
            <div className="admin-ledger-scroll">
              <table className="admin-ledger-table">
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
                <tbody>{activity.map((entry) => <tr key={entry.id}><td>{formatActivityTime(entry.createdAt)}</td><td><span className="admin-ledger-user">{entry.discordUsername}<small>{entry.discordUserId}</small></span></td><td>{formatActivityAction(entry.action)}</td><td>{entry.resourceId || "—"}</td><td>{entry.ipAddress || "—"}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="admin-empty">No activity has been recorded yet.</p>}
        </AdminSection>
        </div>
      </section>
      <SiteCredit />
      {(dirtyCount > 0 || savingAll) && <div className="admin-save-dock" role="region" aria-label="Unsaved changes">
        <span aria-live="polite">{savingAll ? "Saving changes…" : `${dirtyCount} ${dirtyCount === 1 ? "item" : "items"} changed`}</span>
        {Object.keys(saveErrors).length > 0 && <small role="alert">Some changes could not save. Check the marked entries and retry.</small>}
        {Object.values(saveErrors).some(error => error.includes("login has expired")) && <a href={apiUrl("/api/auth/discord")} target="_blank" rel="noreferrer">Sign in again in a new tab, then retry</a>}
        <button type="button" onClick={saveAll} disabled={savingAll || foodBusy}>{savingAll ? "Saving…" : "Save all"}</button>
      </div>}
    </main>
  );
}

export default function App() {
  const route = window.location.pathname.replace(/\/$/, "");
  if (route === "/admin") return <AdminPage />;
  if (route === "/fanart") return <PublicAtmosphere gallery><FanartPage /></PublicAtmosphere>;
  return <PublicAtmosphere><Site /></PublicAtmosphere>;
}
