export const SXBERTY_FOOD_NAME_MAX_LENGTH = 80;
export const SXBERTY_FOOD_MAX_BYTES = 3 * 1024 * 1024;
export const SXBERTY_FOOD_STAT_KEYS = Object.freeze(["fullness", "happiness", "energy"]);
const fields = new Set(["name", "enabled", ...SXBERTY_FOOD_STAT_KEYS]);
const forbiddenCharacters = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function isSxbertyFoodId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
}

function validateMetadata(body, partial) {
  if (!body || typeof body !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(body))) invalid("Send a plain food metadata object");
  const keys = Reflect.ownKeys(body);
  if (!keys.length) invalid("Provide food metadata");
  const result = {};
  for (const key of keys) {
    if (!fields.has(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(body, key), "value")) invalid("Unknown food metadata field");
    const value = body[key];
    if (key === "name") {
      if (typeof value !== "string" || forbiddenCharacters.test(value) || !value.trim() || value.trim().length > SXBERTY_FOOD_NAME_MAX_LENGTH) {
        invalid(`Food name must be plain text between 1 and ${SXBERTY_FOOD_NAME_MAX_LENGTH} characters`);
      }
      result.name = value.trim();
    } else if (key === "enabled") {
      if (typeof value !== "boolean") invalid("Food enabled must be a boolean");
      result.enabled = value;
    } else {
      if (!Number.isInteger(value) || value < 0 || value > 100) invalid(`${key} must be an integer from 0 to 100`);
      result[key] = value;
    }
  }
  if (!partial) {
    for (const key of ["name", ...SXBERTY_FOOD_STAT_KEYS]) {
      if (!Object.hasOwn(result, key)) invalid(`Food ${key} is required`);
    }
    if (!Object.hasOwn(result, "enabled")) result.enabled = true;
  }
  return result;
}

export const validateSxbertyFoodCreate = body => validateMetadata(body, false);
export const validateSxbertyFoodPatch = body => validateMetadata(body, true);

// Construct rather than spread: binary data, filesystem paths, timestamps and
// future private properties must never leak through catalog responses.
export function toSxbertyFoodDto(item, admin = false) {
  if (!isSxbertyFoodId(item?.id)) throw new Error("Invalid stored food ID");
  const metadata = validateSxbertyFoodCreate({
    name: item.name, enabled: item.enabled,
    fullness: item.fullness, happiness: item.happiness, energy: item.energy
  });
  return {
    id: item.id, ...metadata,
    url: `/api/sxberty-foods/${item.id}/image`,
    ...(admin ? { adminPreviewUrl: `/api/admin/sxberty-foods/${item.id}/image` } : {})
  };
}

export function normalizePublicFood(value) {
  try {
    if (!value || value.enabled !== true || !isSxbertyFoodId(value.id) ||
        value.url !== `/api/sxberty-foods/${value.id}/image`) return null;
    return toSxbertyFoodDto(value);
  } catch {
    return null;
  }
}
