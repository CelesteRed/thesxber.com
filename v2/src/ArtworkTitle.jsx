import { safeCreditUrl } from "../server/fanart-fields.js";

export default function ArtworkTitle({ entry }) {
  const title = entry.title || `Fanart ${entry.id}`;
  const href = safeCreditUrl(entry.creditUrl);
  return href ? <a className="artwork-credit-link" href={href} target="_blank" rel="noopener noreferrer">{title}</a> : <span>{title}</span>;
}
