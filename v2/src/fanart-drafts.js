export function updateFanartDraft(entry, draft, changes) {
  const next = { ...draft, ...changes };
  for (const key of Object.keys(next)) {
    const saved = entry[key] ?? (key === "embedCrop" ? null : key === "embedEligible" ? false : "");
    const same = key === "embedCrop"
      ? (next[key] === null && saved === null) || (next[key] && saved && ["offsetX", "offsetY", "zoom"].every(field => next[key][field] === saved[field]))
      : next[key] === saved;
    if (same) delete next[key];
  }
  return next;
}
