import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { durationLabel, publishedLabel, viewLabel } from "./video-display.js";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

function ShortsTitle({ title }) {
  const container = useRef(null);
  const text = useRef(null);
  const [metrics, setMetrics] = useState({ overflow: false, distance: 0 });
  useEffect(() => {
    const measure = () => {
      const width = text.current.getBoundingClientRect().width;
      setMetrics({ overflow: width > container.current.clientWidth + 1, distance: width + 24 });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container.current);
    observer.observe(text.current);
    measure();
    return () => observer.disconnect();
  }, [title]);
  return <span ref={container} className="media-card-title media-card-title--scroll" title={title}
    style={{ '--title-offset': `-${metrics.distance}px`, '--title-duration': `${Math.max(8, metrics.distance / 25)}s` }}>
    <span className={`media-title-track${metrics.overflow ? ' media-title-track--overflow' : ''}`}>
      <span ref={text} className="media-title-text">{title}</span>
      {metrics.overflow && <span className="media-title-copy" aria-hidden="true">{title}</span>}
    </span>
  </span>;
}

function VideoCard({ item }) {
  const views = viewLabel(item.viewCount);
  const published = publishedLabel(item.publishedAt);
  const duration = durationLabel(item.duration);
  const description = item.hoverText || item.description;
  return <a className="media-card" href={item.videoUrl} target="_blank" rel="noreferrer" aria-label={`${item.title} — watch on YouTube`} draggable={false}>
    <img src={item.thumbnail} alt="" loading="lazy" decoding="async" draggable={false} />
    <div className="media-card-top">
      {item.format === 'short' ? <ShortsTitle title={item.title} /> : <span className="media-card-title" title={item.title}>{item.title}</span>}
      <span className="media-card-views" aria-label={views === null ? "View count unavailable" : `${viewLabel(item.viewCount, false)} views`} title={views === null ? "View count unavailable" : `${viewLabel(item.viewCount, false)} views`}>
        <span className="media-eye" aria-hidden="true" />{views ?? "—"}
      </span>
      {published && <time className="media-card-date" dateTime={item.publishedAt}>{published}</time>}
    </div>
    <div className="media-card-details">
      {duration && <div className="media-card-meta">
        {duration && <span>{duration}</span>}
      </div>}
      {description && <p className="media-card-description">{description}</p>}
      <span className="media-card-watch">Open <span aria-hidden="true">↗</span></span>
    </div>
  </a>;
}

function MediaShelf({ title, format, feed, onNavigate }) {
  const viewport = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [capacity, setCapacity] = useState(1);
  const placeholderImages = useMemo(() => {
    const thumbnails = feed.items.filter(item => item.format === 'short' && item.thumbnail).map(item => item.thumbnail);
    for (let index = thumbnails.length - 1; index > 0; index--) {
      const random = Math.floor(Math.random() * (index + 1));
      [thumbnails[index], thumbnails[random]] = [thumbnails[random], thumbnails[index]];
    }
    return thumbnails;
  }, [feed.items]);
  const items = feed.items.filter(item => item.format === format);
  const pendingFormats = feed.items.some(item => !["video", "short"].includes(item.format));
  const id = `feed-${format}`;
  const updateEdges = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    setEdges({ start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 });
    const track = element.querySelector('.media-shelf-track');
    const slot = track?.firstElementChild;
    if (slot) {
      const gap = parseFloat(getComputedStyle(track).gap) || 0;
      const width = slot.getBoundingClientRect().width;
      if (width > 0) setCapacity(Math.max(1, Math.ceil((track.clientWidth + gap - 1) / (width + gap))));
    }
  }, []);

  useEffect(() => {
    updateEdges();
    const observer = new ResizeObserver(updateEdges);
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [feed, capacity, updateEdges]);

  function scroll(direction) {
    const element = viewport.current;
    if (!element) return;
    onNavigate();
    element.scrollBy({
      left: direction * element.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"
    });
  }

  return <section className={`media-shelf media-shelf--${format}`} aria-labelledby={`${id}-title`}>
    <div className="media-shelf-heading">
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="media-shelf-controls">
        <button type="button" className="nav-arrow" aria-label={`Previous ${title}`} aria-controls={id} disabled={edges.start} onClick={() => scroll(-1)}><i className="fa-solid fa-chevron-left" aria-hidden="true" /></button>
        <button type="button" className="nav-arrow" aria-label={`Next ${title}`} aria-controls={id} disabled={edges.end} onClick={() => scroll(1)}><i className="fa-solid fa-chevron-right" aria-hidden="true" /></button>
      </div>
    </div>
    <div className="media-shelf-viewport" id={id} ref={viewport} onScroll={updateEdges} tabIndex={0}
      role="region" aria-label={`${title} carousel`} aria-busy={feed.status === "loading"}
      onKeyDown={event => {
        if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        scroll(event.key === "ArrowLeft" ? -1 : 1);
      }}>
      {feed.status !== "ready" || (!items.length && pendingFormats) ?
        <p className="media-feed-state" role="status">{feed.status === "loading" ? "Loading…" : feed.status === "error" ? "Unable to load videos. Please try again later." : pendingFormats ? "Some uploads could not be identified. Please try again later." : format === "short" ? "No Shorts yet." : "No videos yet."}</p> :
        <div className="media-shelf-track">
          {items.map(item => <div className="media-shelf-slot" key={item.id}>
            <VideoCard item={item} />
          </div>)}
          {Array.from({ length: Math.max(0, capacity - items.length) }, (_, index) =>
            <div className="media-shelf-slot" key={`coming-soon-${index}`}>
              <div className="media-card media-card--placeholder">
                {placeholderImages.length > 0 && <img className="media-placeholder-image" src={placeholderImages[index % placeholderImages.length]} alt="" loading="lazy" decoding="async" draggable={false} />}
                <div className="media-card-top"><span className="media-card-title">Coming Soon...</span></div>
              </div>
            </div>)}
        </div>}
    </div>
  </section>;
}

export default function MediaFeed() {
  const audio = useRef(null);
  const [feed, setFeed] = useState({ status: "loading", items: [] });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/youtube`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error("Feed request failed"); return response.json(); })
      .then(data => { if (!controller.signal.aborted) setFeed({ status: "ready", items: Array.isArray(data.items) ? data.items : [] }); })
      .catch(() => { if (!controller.signal.aborted) setFeed({ status: "error", items: [] }); });
    return () => controller.abort();
  }, []);
  const playClick = () => {
    if (!audio.current) return;
    audio.current.currentTime = 0;
    audio.current.play().catch(() => {});
  };
  return <main className="media-feed">
    <MediaShelf title="Latest Videos" format="video" feed={feed} onNavigate={playClick} />
    <MediaShelf title="Shorts" format="short" feed={feed} onNavigate={playClick} />
    <audio ref={audio} preload="none" src="/nextpageclick.mp3" />
  </main>;
}
