export function viewLabel(value, compact = true) {
  if (value === null || value === undefined || !/^\d+$/.test(String(value))) return null;
  return new Intl.NumberFormat("en", compact ? { notation: "compact", maximumFractionDigits: 1 } : {}).format(BigInt(value));
}

export function durationLabel(value) {
  const match = typeof value === "string" && value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return null;
  const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
  if (!seconds) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours ? `${hours}:${String(minutes).padStart(2,"0")}:${String(seconds % 60).padStart(2,"0")}` : `${minutes}:${String(seconds % 60).padStart(2,"0")}`;
}

export function publishedLabel(value) {
  const date = value && new Date(value);
  return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date) : null;
}
