export const DESCRIPTION_LIMIT = 100;

export function normalizeDescription(value) {
  if (typeof value !== "string" || value.length > DESCRIPTION_LIMIT) {
    throw new Error(`Descriptions must be ${DESCRIPTION_LIMIT} characters or fewer`);
  }
  return value.trim();
}

export function normalizeCreditUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw new Error("Artist link must be a valid HTTP or HTTPS URL");
  if (!value.trim()) return "";
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Artist link must be a full URL, such as https://x.com/artist"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Artist link must use HTTP or HTTPS and cannot contain credentials");
  }
  return url.href;
}

export function safeCreditUrl(value) {
  try { return normalizeCreditUrl(value || ""); } catch { return ""; }
}
