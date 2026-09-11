import { useEffect, useRef, useState } from "react";
import MarkdownText from "./MarkdownText";
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const assetUrl = (path) => `${API_BASE}${path}`;

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

export default function FanartTile({ entry, onOpenLightbox }) {
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
        onClick={() => { hideTooltip(); onOpenLightbox(entry); }}
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

