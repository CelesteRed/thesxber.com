// Shared by the admin preview and server renderer. Offsets use frame-height units.
export const DEFAULT_BANNER_CROP = { offsetX: 0, offsetY: 0, zoom: 1 };
export const MAX_BANNER_ZOOM = 3;

export function bannerLayout(width, height, crop) {
  const zoom = Math.min(MAX_BANNER_ZOOM, Math.max(1, crop.zoom));
  const scale = Math.max(4 / width, 1 / height) * zoom;
  const renderedWidth = width * scale;
  const renderedHeight = height * scale;
  const maxX = Math.max(0, (renderedWidth - 4) / 2);
  const maxY = Math.max(0, (renderedHeight - 1) / 2);
  return {
    width: renderedWidth, height: renderedHeight, zoom,
    offsetX: Math.min(maxX, Math.max(-maxX, crop.offsetX)),
    offsetY: Math.min(maxY, Math.max(-maxY, crop.offsetY))
  };
}

export function clampBannerCrop(width, height, crop) {
  const { offsetX, offsetY, zoom } = bannerLayout(width, height, crop);
  return { offsetX, offsetY, zoom };
}

export function validateBannerCrop(crop) {
  if (crop === null) return null;
  if (!crop || typeof crop !== "object" || Array.isArray(crop) ||
      ![crop.offsetX, crop.offsetY, crop.zoom].every(Number.isFinite) ||
      crop.zoom < 1 || crop.zoom > MAX_BANNER_ZOOM ||
      Math.abs(crop.offsetX) > 100000 || Math.abs(crop.offsetY) > 100000) {
    throw new Error("Provide valid crop offsets and a zoom between 1 and 3, or null for automatic cropping");
  }
  return { offsetX: crop.offsetX, offsetY: crop.offsetY, zoom: crop.zoom };
}

export function bannerSourceRect(width, height, crop) {
  const layout = bannerLayout(width, height, crop);
  const scale = layout.height / height;
  const cropWidth = Math.min(width, Math.max(1, Math.round(4 / scale)));
  const cropHeight = Math.min(height, Math.max(1, Math.round(1 / scale)));
  return {
    left: Math.max(0, Math.min(width - cropWidth, Math.round((layout.width / 2 - 2 - layout.offsetX) / scale))),
    top: Math.max(0, Math.min(height - cropHeight, Math.round((layout.height / 2 - 0.5 - layout.offsetY) / scale))),
    width: cropWidth, height: cropHeight
  };
}
