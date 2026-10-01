import { normalizePet, SXBERTY_STORAGE_KEY } from "./verity-pet.js";

let fallbackQueue = Promise.resolve();
function availableLocks() {
  try { return globalThis.navigator?.locks; } catch { return null; }
}

// Call inside withPetLock. A hydration/tick timestamp is not a storage
// revision: a successfully read persisted snapshot always wins. Only failed
// writes explicitly preserve newer in-memory care until storage works again.
export function readLatestPet(storage, memory, preferMemory = false) {
  if (preferMemory || !storage) return memory;
  try {
    const serialized = storage.getItem(SXBERTY_STORAGE_KEY);
    if (serialized === null) return null;
    return normalizePet(JSON.parse(serialized)) || memory;
  } catch {
    return memory;
  }
}

// All read/modify/save operations use the same origin-wide Web Lock. The
// fallback keeps a private/restricted browser's in-memory pet usable even when
// Web Locks are unavailable; it can only serialize within that document.
export async function withPetLock(action, lockManager = availableLocks()) {
  if (typeof lockManager?.request === "function") {
    let invoked = false;
    try {
      return await lockManager.request(`${SXBERTY_STORAGE_KEY}:write`, () => {
        invoked = true;
        return action();
      });
    } catch (error) {
      // A denied lock may fall back, but an action must never execute twice.
      if (invoked) throw error;
    }
  }
  const result = fallbackQueue.then(action);
  fallbackQueue = result.catch(() => {});
  return result;
}
