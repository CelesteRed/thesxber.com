export const SXBERTY_STORAGE_KEY = 'sxber-verity-pet-v1';
export const VERITY_STORAGE_KEY = SXBERTY_STORAGE_KEY;
export const UNLOCK_CLICKS = 10;
export const COUNTDOWN_MS = 60 * 1000;
export const SCARE_LEASE_MS = 8 * 1000;
export const FORMATION_MS = 2 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MAX_BOND = Number.MAX_SAFE_INTEGER;
const INITIAL_STATS = { fullness: 80, happiness: 100, energy: 90 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeNow(now) {
  return Number.isFinite(now) ? clamp(Math.floor(now), 0, Number.MAX_SAFE_INTEGER) : 0;
}

function stat(value, fallback) {
  return Number.isFinite(value) ? clamp(value, 0, 100) : fallback;
}

function timestamp(value, fallback, now) {
  return Number.isFinite(value) ? clamp(Math.floor(value), 0, now) : fallback;
}

function formingPet(pet, now) {
  return {
    ...createPet(now),
    generation: pet.generation < Number.MAX_SAFE_INTEGER ? pet.generation + 1 : 1,
    stage: 'forming',
    paused: pet.paused,
  };
}

export function createPet(now = Date.now()) {
  const time = safeNow(now);
  return {
    version: 3,
    generation: 1,
    stage: 'alive',
    stageStartedAt: time,
    adoptedAt: time,
    updatedAt: time,
    ...INITIAL_STATS,
    bond: 0,
    sleeping: false,
    hidden: false,
    paused: false,
  };
}

export function normalizePet(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![1, 2, 3].includes(value.version)) {
    return null;
  }

  const time = safeNow(now);
  const adoptedAt = timestamp(value.adoptedAt, time, time);
  const next = {
    version: 3,
    generation: value.version === 3 && Number.isSafeInteger(value.generation) && value.generation > 0
      ? value.generation : 1,
    stage: 'alive',
    stageStartedAt: adoptedAt,
    adoptedAt,
    updatedAt: Math.max(adoptedAt, timestamp(value.updatedAt, time, time)),
    fullness: stat(value.fullness, INITIAL_STATS.fullness),
    happiness: stat(value.happiness, INITIAL_STATS.happiness),
    energy: stat(value.energy, INITIAL_STATS.energy),
    bond: Number.isFinite(value.bond) ? clamp(Math.floor(value.bond), 0, MAX_BOND) : 0,
    sleeping: value.sleeping === true,
    hidden: value.hidden === true,
    paused: value.paused === true,
  };

  if (value.version === 3) {
    if (['alive', 'countdown', 'scaring', 'forming'].includes(value.stage)) {
      next.stage = value.stage;
      // A fractional happiness value can cross zero between whole milliseconds.
      next.stageStartedAt = Math.max(adoptedAt, Number.isFinite(value.stageStartedAt)
        ? clamp(value.stageStartedAt, 0, time) : time);
      next.updatedAt = Math.max(next.updatedAt, next.stageStartedAt);
    }
    if (next.stage === 'alive' && next.happiness === 0) {
      next.stage = 'countdown';
      next.stageStartedAt = time;
      next.updatedAt = time;
    }
  } else if (next.happiness === 0 || value.scarePending === true) {
    // Legacy pending scares get a full warning rather than firing on migration.
    next.stage = 'countdown';
    next.stageStartedAt = time;
    next.updatedAt = time;
  }
  if (next.stage === 'countdown' || next.stage === 'scaring') next.happiness = 0;
  return next;
}

export function advancePet(pet, now = Date.now()) {
  const time = safeNow(now);
  const next = normalizePet(pet, time);
  if (!next) return null;

  if (next.stage === 'scaring' && time - next.stageStartedAt >= SCARE_LEASE_MS) {
    // A lost owner must never replay the scare or catch up multiple generations.
    return formingPet(next, time);
  }

  if (next.stage === 'forming' && time - next.stageStartedAt >= FORMATION_MS) {
    next.stage = 'alive';
    next.stageStartedAt += FORMATION_MS;
    next.updatedAt = Math.max(next.updatedAt, next.stageStartedAt);
  }

  if (next.stage === 'alive') {
    const elapsedMs = Math.max(0, time - next.updatedAt);
    const untilZero = next.happiness * MINUTE;
    // Only the living interval consumes needs, including during offline catch-up.
    const livingMs = Math.min(elapsedMs, untilZero);
    const hours = livingMs / HOUR;
    next.fullness = clamp(next.fullness - 4 * hours, 0, 100);
    next.energy = clamp(next.energy + (next.sleeping ? 20 : -5) * hours, 0, 100);
    if (elapsedMs >= untilZero) {
      next.stage = 'countdown';
      next.stageStartedAt = next.updatedAt + untilZero;
      next.happiness = 0;
    } else {
      // Sleep, hiding, and pausing never suspend happiness decay.
      next.happiness = clamp(next.happiness - elapsedMs / MINUTE, 0, 100);
    }
  }
  next.updatedAt = time;
  return next;
}

// Call read/claim/save together inside withPetLock to elect one document owner.
export function claimPetScare(pet, now = Date.now()) {
  const next = advancePet(pet, now);
  if (!next) return { pet: null, scare: false };

  const scare = next.stage === 'countdown' && safeNow(now) - next.stageStartedAt >= COUNTDOWN_MS;
  if (scare) {
    next.stage = 'scaring';
    next.stageStartedAt = safeNow(now);
  }
  return { pet: next, scare };
}

export function getScareToken(pet) {
  return pet?.stage === 'scaring' ? `${pet.generation}:${pet.adoptedAt}:${pet.stageStartedAt}` : null;
}

export function finishPetScare(pet, expectedToken, now = Date.now()) {
  const time = safeNow(now);
  const next = normalizePet(pet, time);
  // Compare the persisted identity before clock repair can alter its timestamps.
  if (!next || next.stage !== 'scaring' || typeof expectedToken !== 'string' || getScareToken(pet) !== expectedToken) {
    return next;
  }
  return formingPet(next, time);
}

export const enterPetVisit = claimPetScare;

export function careForPet(pet, action, now = Date.now()) {
  const next = advancePet(pet, now);
  if (!next) return null;
  if (next.stage !== 'alive' && ['feed', 'play', 'pet', 'sleep'].includes(action)) return next;

  let bonded = false;
  switch (action) {
    case 'feed':
      if (!next.sleeping && next.fullness < 100) {
        next.fullness = Math.min(100, next.fullness + 22);
        bonded = true;
      }
      break;
    case 'play':
      if (!next.sleeping && next.energy >= 12) {
        next.happiness = Math.min(100, next.happiness + 18);
        next.energy -= 12;
        next.fullness = Math.max(0, next.fullness - 6);
        bonded = true;
      }
      break;
    case 'pet':
      if (next.happiness < 100) {
        next.happiness = Math.min(100, next.happiness + 8);
        bonded = true;
      }
      break;
    case 'sleep':
      next.sleeping = !next.sleeping;
      break;
    case 'hide':
      next.hidden = true;
      break;
    case 'show':
      next.hidden = false;
      break;
    case 'pause':
      next.paused = !next.paused;
      break;
    default:
      break;
  }
  if (bonded) next.bond = Math.min(MAX_BOND, next.bond + 1);
  return next;
}

export function loadPet(storage, now = Date.now()) {
  try {
    const serialized = storage.getItem(SXBERTY_STORAGE_KEY);
    if (!serialized) return null;
    return advancePet(JSON.parse(serialized), now);
  } catch {
    return null;
  }
}

export function savePet(storage, pet) {
  try {
    const normalized = normalizePet(pet);
    if (!normalized) return false;
    storage.setItem(SXBERTY_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}
