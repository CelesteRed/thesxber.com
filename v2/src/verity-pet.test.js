import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SXBERTY_STORAGE_KEY,
  VERITY_STORAGE_KEY,
  UNLOCK_CLICKS,
  COUNTDOWN_MS,
  SCARE_LEASE_MS,
  FORMATION_MS,
  DEATH_DELAY_MS,
  RETURN_FALL_MS,
  getPetLifeToken,
  getPetPresence,
  applyPetEvent,
  takeDeathComment,
  createPet,
  normalizePet,
  advancePet,
  enterPetVisit,
  claimPetScare,
  getScareToken,
  finishPetScare,
  careForPet,
  loadPet,
  savePet,
} from './verity-pet.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const START = 1_700_000_000_000;

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getItem(key) {
      assert.equal(key, SXBERTY_STORAGE_KEY);
      return value;
    },
    setItem(key, next) {
      assert.equal(key, SXBERTY_STORAGE_KEY);
      value = next;
    },
  };
}

function stats(pet) {
  return [pet.fullness, pet.happiness, pet.energy, pet.bond];
}

function approxStats(pet, expected) {
  stats(pet).forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${value} != ${expected[index]}`));
}

test('new pets have the versioned defaults and requested unlock threshold', () => {
  assert.equal(SXBERTY_STORAGE_KEY, 'sxber-verity-pet-v1');
  assert.equal(VERITY_STORAGE_KEY, SXBERTY_STORAGE_KEY);
  assert.equal(UNLOCK_CLICKS, 10);
  assert.equal(COUNTDOWN_MS, 10000);
  assert.equal(SCARE_LEASE_MS, 8000);
  assert.equal(DEATH_DELAY_MS, 10000);
  assert.equal(RETURN_FALL_MS, 1200);
  assert.equal(FORMATION_MS, RETURN_FALL_MS);
  assert.deepEqual(createPet(START), {
    version: 4,
    generation: 1,
    stage: 'alive',
    stageStartedAt: START,
    adoptedAt: START,
    updatedAt: START,
    fullness: 80,
    happiness: 100,
    energy: 90,
    bond: 0,
    sleeping: false,
    hidden: false,
    paused: false,
    lastDeath: null,
    recentEventIds: [],
  });
  const before = Date.now();
  const pet = createPet();
  assert.ok(pet.adoptedAt >= before && pet.adoptedAt <= Date.now());
});

test('normalization rejects unrecognized data and strips extra properties', () => {
  for (const value of [null, undefined, false, 1, 'pet', [], {}, { version: 5 }, { version: '1' }, { version: '2' }, { version: '3' }, { version: '4' }]) {
    assert.equal(normalizePet(value, START), null);
    assert.equal(advancePet(value, START), null);
    assert.equal(careForPet(value, 'feed', START), null);
    assert.deepEqual(claimPetScare(value, START), { pet: null, scare: false });
    assert.equal(finishPetScare(value, 'bad-token', START), null);
  }
  assert.deepEqual(normalizePet({ version: 1 }, START), createPet(START));
  assert.deepEqual(normalizePet({ version: 2 }, START), createPet(START));
  assert.deepEqual(normalizePet({ version: 3 }, START), createPet(START));
  assert.deepEqual(normalizePet({ version: 4 }, START), createPet(START));
  assert.deepEqual(normalizePet({ ...createPet(START), extra: 'ignored', scarePending: true, zeroLatched: true }, START), createPet(START));
});

test('normalization clamps finite stats and uses defaults for malformed stats', () => {
  const pet = normalizePet({
    ...createPet(START),
    fullness: -10,
    happiness: 101,
    energy: 45.5,
    bond: 3.9,
    hidden: 'true',
    sleeping: 1,
    paused: true,
  }, START);
  assert.deepEqual(stats(pet), [0, 100, 45.5, 3]);
  assert.equal(pet.hidden, false);
  assert.equal(pet.sleeping, false);
  assert.equal(pet.paused, true);
  for (const bad of [undefined, null, '50', {}, [], NaN, Infinity, -Infinity]) {
    assert.deepEqual(stats(normalizePet({
      ...createPet(START), fullness: bad, happiness: bad, energy: bad, bond: bad,
    }, START)), [80, 100, 90, 0]);
  }
  assert.equal(normalizePet({ ...pet, bond: -4 }, START).bond, 0);
  assert.equal(normalizePet({ ...pet, bond: 1e100 }, START).bond, Number.MAX_SAFE_INTEGER);
});

test('timestamps are finite, ordered, nonnegative and never in the future', () => {
  const future = normalizePet({ ...createPet(START), adoptedAt: START + HOUR, updatedAt: START + 2 * HOUR }, START);
  assert.equal(future.adoptedAt, START);
  assert.equal(future.updatedAt, START);
  const reversed = normalizePet({ ...createPet(START), updatedAt: START - HOUR }, START);
  assert.equal(reversed.updatedAt, START);
  const negative = normalizePet({ ...createPet(START), adoptedAt: -5, updatedAt: -1, stageStartedAt: -3 }, START);
  assert.equal(negative.adoptedAt, 0);
  assert.equal(negative.updatedAt, 0);
  assert.equal(negative.stageStartedAt, 0);
  for (const bad of [undefined, null, 'yesterday', NaN, Infinity]) {
    assert.deepEqual(normalizePet({ ...createPet(START), adoptedAt: bad, updatedAt: bad }, START), createPet(START));
  }
  assert.equal(createPet(START + 0.9).updatedAt, START);
  for (const badNow of [-1, NaN, Infinity, null, 'now']) {
    assert.equal(createPet(badNow).updatedAt, 0);
    assert.equal(advancePet(createPet(START), badNow).updatedAt, 0);
  }
});

test('awake needs retain their hourly rates while happiness loses one per minute', () => {
  const original = Object.freeze(createPet(START));
  const later = advancePet(original, START + HOUR);
  assert.deepEqual(stats(later), [76, 40, 85, 0]);
  assert.equal(later.adoptedAt, START);
  assert.equal(later.updatedAt, START + HOUR);
  assert.deepEqual(stats(original), [80, 100, 90, 0]);
  const minute = advancePet(original, START + MINUTE);
  assert.ok(Math.abs(minute.fullness - (80 - 4 / 60)) < 1e-10);
  assert.equal(minute.happiness, 99);
  assert.ok(Math.abs(minute.energy - (90 - 5 / 60)) < 1e-10);
  assert.deepEqual(advancePet(later, later.updatedAt), later);
});

test('happiness decay retains fractional minutes and repeated small ticks', () => {
  const pet = createPet(START);
  for (const elapsedMs of [1, 1000, 15_000, 30_000, 60_000, 89_500, 99 * MINUTE]) {
    assert.equal(advancePet(pet, START + elapsedMs).happiness, 100 - elapsedMs / MINUTE);
  }
  let ticked = pet;
  for (let elapsedMs = 15_000; elapsedMs <= MINUTE; elapsedMs += 15_000) {
    ticked = advancePet(ticked, START + elapsedMs);
  }
  assert.equal(ticked.happiness, 99);
  assert.equal(ticked.stage, 'alive');
});

test('sleeping, hidden, and paused combinations never suspend happiness', () => {
  for (const sleeping of [false, true]) {
    for (const hidden of [false, true]) {
      for (const paused of [false, true]) {
        const pet = { ...createPet(START), sleeping, hidden, paused };
        const tick = advancePet(pet, START + MINUTE / 2);
        assert.equal(tick.happiness, 99.5);
        const offline = advancePet(pet, START + 100 * MINUTE);
        assert.equal(offline.happiness, 0);
        assert.equal(offline.stage, 'countdown');
        assert.equal(offline.stageStartedAt, START + 100 * MINUTE);
      }
    }
  }
});

test('offline decay stops at zero and never silently consumes a countdown', () => {
  const now = START + 500 * HOUR;
  const later = advancePet(createPet(START), now);
  approxStats(later, [80 - 4 * 100 / 60, 0, 90 - 5 * 100 / 60, 0]);
  assert.equal(later.updatedAt, now);
  assert.equal(later.adoptedAt, START);
  assert.equal(later.stage, 'countdown');
  assert.equal(later.stageStartedAt, START + 100 * MINUTE);
  assert.deepEqual(careForPet(later, 'feed', now), later);
  assert.deepEqual(advancePet(later, now), later);
  const storage = memoryStorage();
  assert.equal(savePet(storage, later), true);
  assert.deepEqual(loadPet(storage, now), later);
});

test('backwards clocks and future saved timestamps do not decay or restore stats', () => {
  const pet = { ...createPet(START), fullness: 25, energy: 10 };
  const earlier = advancePet(pet, START - HOUR);
  assert.deepEqual(stats(earlier), stats(pet));
  assert.equal(earlier.updatedAt, START - HOUR);
  assert.equal(earlier.adoptedAt, START - HOUR);
  assert.deepEqual(stats(advancePet(earlier, START)), [21, 40, 5, 0]);
  const stored = memoryStorage(JSON.stringify({ ...pet, updatedAt: START + HOUR }));
  assert.deepEqual(stats(loadPet(stored, START)), stats(pet));
});

test('sleep recovers energy while hunger and happiness still decay', () => {
  const sleeping = careForPet({ ...createPet(START), energy: 10 }, 'sleep', START);
  assert.equal(sleeping.sleeping, true);
  assert.deepEqual(stats(advancePet(sleeping, START + HOUR)), [76, 40, 30, 0]);
  const stopped = advancePet(sleeping, START + 10 * HOUR);
  approxStats(stopped, [80 - 4 * 100 / 60, 0, 10 + 20 * 100 / 60, 0]);
  const awake = careForPet(sleeping, 'sleep', START + HOUR);
  assert.equal(awake.sleeping, false);
  assert.equal(awake.energy, 30);
  assert.equal(advancePet(awake, START + 1.5 * HOUR).energy, 27.5);
});

test('successful care applies bounded effects and adds one bond', () => {
  const pet = Object.freeze({ ...createPet(START), happiness: 80 });
  assert.deepEqual(stats(careForPet(pet, 'feed', START)), [80, 80, 90, 0]);
  assert.deepEqual(stats(careForPet(pet, 'play', START)), [74, 98, 78, 1]);
  assert.deepEqual(stats(careForPet(pet, 'pet', START)), [80, 88, 90, 1]);
  const depleted = { ...pet, fullness: 3, happiness: 99, energy: 12 };
  assert.deepEqual(stats(careForPet(depleted, 'play', START)), [0, 100, 0, 1]);
  assert.equal(careForPet({ ...pet, happiness: 99 }, 'pet', START).happiness, 100);
  assert.equal(careForPet({ ...pet, bond: Number.MAX_SAFE_INTEGER }, 'pet', START).bond, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(pet, { ...createPet(START), happiness: 80 });
});

test('unknown, blocked, and saturated care actions never reward bond', () => {
  const pet = createPet(START);
  for (const action of ['unknown', '', null, undefined, {}, 'toString']) {
    assert.deepEqual(careForPet(pet, action, START), pet);
  }
  const sleeping = { ...pet, sleeping: true, happiness: 80 };
  assert.deepEqual(careForPet(sleeping, 'feed', START), sleeping);
  assert.deepEqual(careForPet(sleeping, 'play', START), sleeping);
  assert.equal(careForPet(sleeping, 'pet', START).bond, 1);
  const tired = { ...pet, energy: 11.99 };
  assert.deepEqual(careForPet(tired, 'play', START), tired);
  const full = { ...pet, fullness: 100, happiness: 100 };
  assert.deepEqual(careForPet(full, 'feed', START), full);
  assert.deepEqual(careForPet(full, 'pet', START), full);
  assert.deepEqual(careForPet(pet, 'unknown', START + HOUR), advancePet(pet, START + HOUR));
});

test('care advances elapsed time before evaluating action eligibility', () => {
  const pet = { ...createPet(START), energy: 16 };
  const later = careForPet(pet, 'play', START + HOUR);
  assert.deepEqual(stats(later), [76, 40, 11, 0]);
  const full = { ...createPet(START), fullness: 100 };
  assert.deepEqual(stats(careForPet(full, 'feed', START + HOUR)), [96, 40, 85, 0]);
});

test('hide/show preserve stats and hiding does not pause simulation', () => {
  const pet = { ...createPet(START), fullness: 30, happiness: 45, energy: 20, bond: 7 };
  const hidden = careForPet(pet, 'hide', START);
  assert.equal(hidden.hidden, true);
  assert.deepEqual(stats(hidden), stats(pet));
  assert.deepEqual(careForPet(hidden, 'hide', START), hidden);
  assert.deepEqual(careForPet(hidden, 'show', START), pet);
  assert.deepEqual(careForPet(pet, 'show', START), pet);
  assert.deepEqual(stats(advancePet(hidden, START + HOUR)), [27, 0, 16.25, 7]);
});

test('pause only stops visual roaming without resetting or freezing needs', () => {
  for (const sleeping of [false, true]) {
    const pet = { ...createPet(START), sleeping, energy: 25, bond: 4 };
    const paused = careForPet(pet, 'pause', START);
    assert.equal(paused.paused, true);
    assert.deepEqual(stats(paused), stats(pet));
    const later = advancePet(paused, START + HOUR);
    assert.deepEqual(stats(later), [76, 40, sleeping ? 45 : 20, 4]);
    assert.equal(later.paused, true);
    assert.equal(later.updatedAt, START + HOUR);
    const resumed = careForPet(paused, 'pause', START + HOUR);
    assert.equal(resumed.paused, false);
    assert.deepEqual(stats(resumed), stats(later));
    const atZero = advancePet(paused, START + 100 * MINUTE);
    approxStats(advancePet(resumed, START + 2 * HOUR), stats(atZero));
    const offline = advancePet(paused, START + 100 * HOUR);
    assert.deepEqual(stats(offline), stats(atZero));
    assert.equal(offline.updatedAt, START + 100 * HOUR);
  }
  const pausedLater = careForPet(createPet(START), 'pause', START + HOUR);
  assert.deepEqual(stats(pausedLater), [76, 40, 85, 0]);
});

test('persistence round-trips the complete schema and loads offline simulation', () => {
  const storage = memoryStorage();
  assert.equal(loadPet(storage, START), null);
  const pet = { ...createPet(START), fullness: 64.5, sleeping: true, hidden: true, paused: true, bond: 8 };
  assert.equal(savePet(storage, pet), true);
  assert.deepEqual(JSON.parse(storage.getItem(VERITY_STORAGE_KEY)), pet);
  assert.deepEqual(loadPet(storage, START), pet);
  assert.deepEqual(stats(loadPet(storage, START + HOUR)), [60.5, 40, 100, 8]);
  assert.equal(savePet(storage, createPet(START)), true);
  assert.deepEqual(loadPet(storage, START + HOUR), advancePet(createPet(START), START + HOUR));
  assert.equal(savePet(storage, { ...pet, extra: 'not persisted' }), true);
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(VERITY_STORAGE_KEY)), 'extra'), false);
});

test('corrupt storage is rejected or sanitized without throwing', () => {
  for (const raw of ['', '{broken', 'null', '[]', 'true', '42', '{}', '{"version":5}', '{"version":"1"}']) {
    assert.equal(loadPet(memoryStorage(raw), START), null);
  }
  const storage = memoryStorage(JSON.stringify({ version: 1, fullness: -40, happiness: 1000, energy: 'bad', bond: -9 }));
  assert.deepEqual(stats(loadPet(storage, START)), [0, 100, 90, 0]);
  for (const invalid of [null, {}, { version: 5 }]) {
    assert.equal(savePet(storage, invalid), false);
  }
});

test('missing or denied storage fails safely, including throwing accessors', () => {
  const denied = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('QuotaExceededError'); },
  };
  const accessors = {
    get getItem() { throw new Error('denied'); },
    get setItem() { throw new Error('denied'); },
  };
  for (const storage of [undefined, null, {}, denied, accessors]) {
    assert.equal(loadPet(storage, START), null);
    assert.equal(savePet(storage, createPet(START)), false);
  }
});

test('healthy version 1 and 2 migration preserves progress and preferences', () => {
  for (const version of [1, 2]) {
    const legacy = Object.freeze({
      version,
      adoptedAt: START - 12 * HOUR,
      updatedAt: START,
      fullness: 36.5,
      happiness: 63.75,
      energy: 29.25,
      bond: 47,
      sleeping: true,
      hidden: true,
      paused: true,
    });
    const expected = { ...legacy, version: 4, generation: 1, stage: 'alive', stageStartedAt: legacy.adoptedAt, lastDeath: null, recentEventIds: [] };
    assert.deepEqual(normalizePet(legacy, START), expected);
    const storage = memoryStorage(JSON.stringify(legacy));
    assert.deepEqual(loadPet(storage, START), expected);
    const offline = loadPet(storage, START + 15 * MINUTE);
    assert.deepEqual(stats(offline), [35.5, 48.75, 34.25, 47]);
    assert.equal(offline.adoptedAt, legacy.adoptedAt);
    assert.equal(savePet(storage, offline), true);
    assert.deepEqual(loadPet(storage, offline.updatedAt), offline);
    assert.equal(legacy.version, version);
  }
});

test('legacy zero and pending scares receive a new full countdown on migration', () => {
  for (const version of [1, 2]) {
    for (const happiness of [0, 8]) {
      const legacy = {
        version, adoptedAt: START - HOUR, updatedAt: START - HOUR,
        happiness, scarePending: happiness > 0, zeroLatched: true, bond: 22, paused: true,
      };
      const storage = memoryStorage(JSON.stringify(legacy));
      const loaded = loadPet(storage, START);
      assert.equal(loaded.version, 4);
      assert.equal(loaded.generation, 1);
      assert.equal(loaded.adoptedAt, START - HOUR);
      assert.equal(loaded.bond, 22);
      assert.equal(loaded.paused, true);
      assert.equal(loaded.happiness, 0);
      assert.equal(loaded.stage, 'countdown');
      assert.equal(loaded.stageStartedAt, START);
      assert.equal(Object.hasOwn(loaded, 'scarePending'), false);
      assert.equal(Object.hasOwn(loaded, 'zeroLatched'), false);
      assert.equal(claimPetScare(loaded, START).scare, false);
      assert.equal(savePet(storage, loaded), true);
      const reloaded = loadPet(storage, START + COUNTDOWN_MS - 1);
      assert.equal(reloaded.stageStartedAt, START);
      assert.equal(claimPetScare(reloaded, START + COUNTDOWN_MS - 1).scare, false);
      assert.equal(claimPetScare(reloaded, START + COUNTDOWN_MS).scare, true);
    }
  }
});

test('malformed lifecycle values are repaired without introducing an instant scare', () => {
  for (const generation of [undefined, null, '2', 0, -1, 1.5, {}, NaN, Infinity, 1e100]) {
    assert.equal(normalizePet({ ...createPet(START), generation }, START).generation, 1);
  }
  assert.equal(normalizePet({ ...createPet(START), generation: 8 }, START).generation, 8);
  for (const stage of [undefined, null, 'dead', 'toString', 0, {}, []]) {
    const healthy = normalizePet({ ...createPet(START), stage }, START);
    assert.equal(healthy.stage, 'alive');
    const zero = normalizePet({ ...createPet(START), happiness: -5, stage }, START);
    assert.equal(zero.stage, 'countdown');
    assert.equal(zero.stageStartedAt, START);
    assert.equal(claimPetScare(zero, START).scare, false);
  }
  for (const stage of ['countdown', 'scaring', 'recovering', 'forming']) {
    for (const stageStartedAt of [undefined, null, 'yesterday', NaN, Infinity, START + HOUR]) {
      const repaired = normalizePet({ ...createPet(START), stage, stageStartedAt }, START);
      assert.equal(repaired.stage, stage);
      assert.equal(repaired.stageStartedAt, START);
      assert.equal(claimPetScare(repaired, START).scare, false);
    }
  }
  const countdown = normalizePet({
    ...createPet(START), stage: 'countdown', happiness: 50, updatedAt: START - 1,
  }, START);
  assert.equal(countdown.happiness, 0);
  assert.equal(countdown.updatedAt, START);
});

test('the exact zero crossing starts an irreversible countdown, not a scare', () => {
  const original = Object.freeze({ ...createPet(START), happiness: 1.5 });
  const before = advancePet(original, START + 1.5 * MINUTE - 1);
  assert.ok(before.happiness > 0);
  assert.equal(before.stage, 'alive');
  const zeroAt = START + 1.5 * MINUTE;
  const zero = advancePet(original, zeroAt);
  assert.equal(zero.happiness, 0);
  assert.equal(zero.stage, 'countdown');
  assert.equal(zero.stageStartedAt, zeroAt);
  assert.equal(getScareToken(zero), null);
  assert.equal(claimPetScare(zero, zeroAt).scare, false);
  for (const action of ['feed', 'play', 'pet', 'sleep']) {
    assert.deepEqual(careForPet(zero, action, zeroAt), zero);
    assert.deepEqual(careForPet(original, action, zeroAt), zero);
  }
  assert.deepEqual(stats(advancePet(zero, zeroAt + 100 * HOUR)), stats(zero));
  assert.equal(original.happiness, 1.5);
  assert.equal(original.stage, 'alive');
});

test('fractional zero-crossing deadlines survive normalization and persistence unchanged', () => {
  const original = { ...createPet(1), happiness: 1 / 7 };
  const zeroAt = original.updatedAt + original.happiness * MINUTE;
  const zero = advancePet(original, Math.ceil(zeroAt));
  assert.equal(zero.stageStartedAt, zeroAt);
  const storage = memoryStorage();
  assert.equal(savePet(storage, zero), true);
  const reloaded = loadPet(storage, Math.ceil(zeroAt) + 1000);
  assert.equal(reloaded.stageStartedAt, zeroAt);
  assert.equal(claimPetScare(reloaded, Math.floor(zeroAt + COUNTDOWN_MS)).scare, false);
  assert.equal(claimPetScare(reloaded, Math.ceil(zeroAt + COUNTDOWN_MS)).scare, true);
});

test('an active visit claims at the exact deadline once, without needing re-entry', () => {
  const start = { ...createPet(START), happiness: 1 };
  const zero = claimPetScare(start, START + MINUTE);
  assert.equal(zero.scare, false);
  const deadline = START + MINUTE + COUNTDOWN_MS;
  assert.equal(claimPetScare(zero.pet, deadline - 1).scare, false);
  assert.equal(advancePet(zero.pet, deadline).stage, 'countdown');
  const claimed = claimPetScare(zero.pet, deadline);
  assert.equal(claimed.scare, true);
  assert.equal(claimed.pet.stage, 'scaring');
  assert.equal(claimed.pet.stageStartedAt, deadline);
  assert.equal(getScareToken(claimed.pet), `1:${START}:${deadline}`);
  assert.equal(claimPetScare(claimed.pet, deadline).scare, false);
  assert.equal(claimPetScare(claimed.pet, deadline + SCARE_LEASE_MS - 1).scare, false);
  assert.deepEqual(enterPetVisit(zero.pet, deadline), claimed);
});

test('reload preserves remaining countdown and overdue offline catch-up only arms', () => {
  const start = { ...createPet(START), happiness: 2.5 };
  const zeroAt = START + 2.5 * MINUTE;
  const storage = memoryStorage(JSON.stringify(start));
  const lateTick = loadPet(storage, zeroAt + COUNTDOWN_MS / 4);
  assert.equal(lateTick.stage, 'countdown');
  assert.equal(lateTick.stageStartedAt, zeroAt);
  assert.equal(savePet(storage, lateTick), true);
  const reloaded = loadPet(storage, zeroAt + 3 * COUNTDOWN_MS / 4);
  assert.equal(reloaded.stageStartedAt, zeroAt);
  assert.equal(COUNTDOWN_MS - (reloaded.updatedAt - reloaded.stageStartedAt), COUNTDOWN_MS / 4);
  assert.equal(claimPetScare(reloaded, zeroAt + COUNTDOWN_MS - 1).scare, false);
  assert.equal(claimPetScare(reloaded, zeroAt + COUNTDOWN_MS).scare, true);
  const overdue = loadPet(storage, START + 500 * HOUR);
  assert.equal(overdue.stage, 'countdown');
  assert.equal(overdue.generation, 1);
  assert.equal(overdue.stageStartedAt, zeroAt);
  const claimed = claimPetScare(overdue, overdue.updatedAt);
  assert.equal(claimed.scare, true);
  assert.equal(claimed.pet.stageStartedAt, overdue.updatedAt);
  assert.equal(claimed.pet.generation, 1);
  const direct = claimPetScare(start, overdue.updatedAt);
  assert.deepEqual(direct, claimed);
});

test('persisted version 4 countdowns keep elapsed time and claim an overdue scare once', () => {
  const zeroAt = START + MINUTE;
  const now = zeroAt + COUNTDOWN_MS + 1;
  const persisted = {
    ...createPet(START), version: 4, happiness: 0, stage: 'countdown',
    stageStartedAt: zeroAt, updatedAt: zeroAt + 1000,
  };
  const storage = memoryStorage(JSON.stringify(persisted));
  const loaded = loadPet(storage, now);
  assert.equal(loaded.stage, 'countdown');
  assert.equal(loaded.stageStartedAt, zeroAt);
  assert.equal(savePet(storage, loaded), true);
  const reloaded = loadPet(storage, now);
  assert.equal(reloaded.stageStartedAt, zeroAt);
  const claimed = claimPetScare(reloaded, now);
  assert.equal(claimed.scare, true);
  assert.equal(claimed.pet.stageStartedAt, now);
  assert.equal(savePet(storage, claimed.pet), true);
  assert.equal(claimPetScare(loadPet(storage, now), now).scare, false);
});

test('only the matching scare token enters recovery before a fresh generation', () => {
  assert.equal(getScareToken(null), null);
  assert.equal(getScareToken(undefined), null);
  assert.equal(getScareToken(createPet(START)), null);
  const doomed = {
    ...createPet(START), stage: 'countdown', happiness: 0, fullness: 4, energy: 5,
    bond: 99, hidden: true, sleeping: true, paused: true, generation: 7,
  };
  const claimedAt = START + COUNTDOWN_MS;
  const claimed = claimPetScare(doomed, claimedAt).pet;
  const token = getScareToken(claimed);
  for (const invalid of [null, undefined, '', '7:wrong:token', {}, token.replace('7:', '6:')]) {
    assert.deepEqual(finishPetScare(claimed, invalid, claimedAt + 500), claimed);
  }
  const finishedAt = claimedAt + 1500;
  const recovering = finishPetScare(Object.freeze(claimed), token, finishedAt);
  assert.equal(recovering.stage, 'recovering');
  assert.equal(recovering.generation, 7);
  assert.deepEqual(stats(recovering), [4, 0, 5, 99]);
  assert.equal(recovering.lastDeath.reason, 'monster');
  assert.equal(recovering.lastDeath.returnAt, claimedAt + DEATH_DELAY_MS);
  assert.deepEqual(finishPetScare(recovering, token, finishedAt + 500), recovering);
  assert.equal(advancePet(recovering, claimedAt + DEATH_DELAY_MS - 1).stage, 'recovering');
  const now = claimedAt + DEATH_DELAY_MS;
  const fresh = advancePet(recovering, now);
  assert.deepEqual(fresh, {
    ...createPet(now), generation: 8, stage: 'forming', paused: true, lastDeath: claimed.lastDeath,
  });
  assert.equal(getScareToken(fresh), null);
  assert.deepEqual(finishPetScare(fresh, token, now + 5000), fresh);
  assert.equal(claimed.stage, 'scaring');
  assert.equal(claimed.generation, 7);
  const nextClaim = claimPetScare(fresh, now + FORMATION_MS + 101 * MINUTE).pet;
  assert.equal(nextClaim.stage, 'scaring');
  assert.notEqual(getScareToken(nextClaim), token);
  assert.deepEqual(finishPetScare(nextClaim, token, nextClaim.updatedAt), nextClaim);
});

test('a closed scare owner recovers after its lease without a duplicate scare or cascaded cycles', () => {
  const claimedAt = START + 101 * MINUTE;
  const claimed = claimPetScare({
    ...createPet(START), hidden: true, sleeping: true, paused: true, bond: 77,
  }, claimedAt).pet;
  const token = getScareToken(claimed);
  const storage = memoryStorage(JSON.stringify(claimed));
  assert.equal(loadPet(storage, claimedAt + SCARE_LEASE_MS - 1).stage, 'scaring');
  const now = claimedAt + SCARE_LEASE_MS;
  const recovered = loadPet(storage, now);
  assert.deepEqual(recovered, { ...claimed, stage: 'recovering', updatedAt: now });
  const returnedAt = claimedAt + DEATH_DELAY_MS;
  const fresh = advancePet(recovered, returnedAt);
  assert.deepEqual(fresh, { ...createPet(returnedAt), generation: 2, stage: 'forming', paused: true, lastDeath: claimed.lastDeath });
  assert.deepEqual(finishPetScare(recovered, token, now), recovered);
  assert.deepEqual(claimPetScare(claimed, now), { pet: recovered, scare: false });
  const longOffline = claimPetScare(claimed, now + 1000 * HOUR);
  assert.equal(longOffline.scare, false);
  assert.equal(longOffline.pet.generation, 2);
  assert.equal(longOffline.pet.stage, 'forming');
  assert.equal(longOffline.pet.stageStartedAt, now + 1000 * HOUR);
  assert.deepEqual(stats(longOffline.pet), [80, 100, 90, 0]);
});

test('formation suspends needs for exactly 1.2 seconds, including after reload', () => {
  const claimed = claimPetScare(createPet(START), START + 101 * MINUTE).pet;
  const now = claimed.updatedAt + DEATH_DELAY_MS;
  const fresh = finishPetScare(claimed, getScareToken(claimed), now);
  const storage = memoryStorage(JSON.stringify(fresh));
  const before = loadPet(storage, now + FORMATION_MS - 1);
  assert.equal(before.stage, 'forming');
  assert.deepEqual(stats(before), [80, 100, 90, 0]);
  assert.equal(savePet(storage, before), true);
  const complete = loadPet(storage, now + FORMATION_MS);
  assert.equal(complete.stage, 'alive');
  assert.equal(complete.stageStartedAt, now + FORMATION_MS);
  assert.deepEqual(stats(complete), [80, 100, 90, 0]);
  const later = advancePet(before, now + FORMATION_MS + MINUTE);
  assert.equal(later.stage, 'alive');
  approxStats(later, [80 - 4 / 60, 99, 90 - 5 / 60, 0]);
  assert.deepEqual(later, advancePet(fresh, later.updatedAt));
  const overdue = advancePet(fresh, now + 1000 * HOUR);
  assert.equal(overdue.generation, 2);
  assert.equal(overdue.stage, 'countdown');
  assert.equal(overdue.stageStartedAt, now + FORMATION_MS + 100 * MINUTE);
});

test('care is blocked outside alive but visibility and roaming preferences remain usable', () => {
  const countdown = advancePet({ ...createPet(START), happiness: 0 }, START);
  const scaring = claimPetScare(countdown, START + COUNTDOWN_MS).pet;
  const recovering = finishPetScare(scaring, getScareToken(scaring), scaring.updatedAt + 1000);
  const forming = advancePet(recovering, scaring.lastDeath.returnAt);
  for (const pet of [countdown, scaring, recovering, forming]) {
    for (const action of ['feed', 'play', 'pet', 'sleep']) {
      assert.deepEqual(careForPet(pet, action, pet.updatedAt), pet);
    }
    const hidden = careForPet(pet, 'hide', pet.updatedAt);
    assert.equal(hidden.hidden, true);
    assert.deepEqual(careForPet(hidden, 'show', pet.updatedAt), pet);
    const paused = careForPet(hidden, 'pause', pet.updatedAt);
    assert.equal(paused.paused, true);
    assert.equal(paused.stageStartedAt, pet.stageStartedAt);
    assert.deepEqual(stats(paused), stats(pet));
  }
  const paused = careForPet(careForPet(countdown, 'pause', START), 'hide', START);
  assert.equal(claimPetScare(paused, START + COUNTDOWN_MS).scare, true);
  const aliveAt = forming.stageStartedAt + FORMATION_MS;
  assert.equal(careForPet(forming, 'feed', aliveAt).bond, 0);
  assert.equal(careForPet(forming, 'sleep', aliveAt).sleeping, true);
});

test('timestamp zero is a real countdown, scare and formation boundary', () => {
  const countdown = normalizePet({ ...createPet(0), stage: 'countdown', happiness: 0 }, 0);
  assert.equal(countdown.stageStartedAt, 0);
  assert.equal(claimPetScare(countdown, COUNTDOWN_MS - 1).scare, false);
  assert.equal(claimPetScare(countdown, COUNTDOWN_MS).scare, true);
  const scaring = { ...countdown, stage: 'scaring' };
  assert.equal(getScareToken(scaring), '1:0:0');
  assert.equal(advancePet(scaring, SCARE_LEASE_MS - 1).stage, 'scaring');
  const recovering = finishPetScare(scaring, '1:0:0', 0);
  assert.equal(recovering.stage, 'recovering');
  assert.equal(recovering.stageStartedAt, 0);
  assert.equal(recovering.lastDeath.at, 0);
  const fresh = advancePet(recovering, DEATH_DELAY_MS);
  assert.equal(fresh.stageStartedAt, DEATH_DELAY_MS);
  assert.equal(advancePet(fresh, DEATH_DELAY_MS + FORMATION_MS - 1).stage, 'forming');
  assert.equal(advancePet(fresh, DEATH_DELAY_MS + FORMATION_MS).stage, 'alive');
});

test('backward and future clocks cannot produce negative needs or repeated scares', () => {
  const claimed = claimPetScare(createPet(START), START + 101 * MINUTE).pet;
  const token = getScareToken(claimed);
  const backwards = claimPetScare(claimed, START - HOUR);
  assert.equal(backwards.scare, false);
  assert.equal(backwards.pet.stage, 'scaring');
  assert.deepEqual(stats(backwards.pet), stats(claimed));
  assert.equal(claimPetScare(backwards.pet, START - HOUR).scare, false);
  const recovered = claimPetScare(backwards.pet, START);
  assert.equal(recovered.scare, false);
  assert.equal(recovered.pet.stage, 'forming');
  assert.equal(recovered.pet.generation, 2);
  assert.deepEqual(finishPetScare(recovered.pet, token, START), recovered.pet);
  assert.equal(finishPetScare(claimed, token, START - HOUR).generation, 1);
  assert.equal(finishPetScare(claimed, token, START - HOUR).stage, 'recovering');
  const countdown = { ...createPet(START), stage: 'countdown', happiness: 0, stageStartedAt: START + HOUR };
  const repaired = claimPetScare(countdown, START);
  assert.equal(repaired.scare, false);
  assert.equal(repaired.pet.stageStartedAt, START);
  assert.equal(claimPetScare(repaired.pet, START + COUNTDOWN_MS).scare, true);
});

function physicalEvent(pet, type, id = 'gesture-1', extra = {}) {
  return { id, type, token: getPetLifeToken(pet), ...extra };
}

test('throws cost one, offscreen costs five total, and lava halves current fractional happiness', () => {
  const pet = Object.freeze({ ...createPet(START), happiness: 83.5, bond: 10 });
  for (const [type, happiness] of [['throw', 82.5], ['offscreen', 78.5], ['lava', 41.75]]) {
    const result = applyPetEvent(pet, physicalEvent(pet, type), START);
    assert.equal(result.accepted, true);
    assert.deepEqual(stats(result.pet), [80, happiness, 90, 10]);
    assert.equal(result.pet.generation, pet.generation);
    assert.equal(result.pet.adoptedAt, pet.adoptedAt);
    assert.deepEqual(result.pet.recentEventIds, ['gesture-1']);
    if (type === 'throw') {
      assert.equal(result.pet.lastDeath, null);
      assert.equal(getPetLifeToken(result.pet), getPetLifeToken(pet));
    } else {
      assert.deepEqual(result.pet.lastDeath, {
        id: 'gesture-1', reason: type, at: START, returnAt: START + DEATH_DELAY_MS,
        face: 'neutral', announced: false,
      });
      assert.notEqual(getPetLifeToken(result.pet), getPetLifeToken(pet));
    }
  }
  assert.equal(pet.happiness, 83.5);
  const later = applyPetEvent(pet, physicalEvent(pet, 'lava'), START + MINUTE).pet;
  assert.equal(later.happiness, 41.25);
  const fractional = { ...pet, happiness: 0.125 };
  assert.equal(applyPetEvent(fractional, physicalEvent(fractional, 'lava'), START).pet.happiness, 0.0625);
});

test('physical deaths disappear for ten seconds then fall for exactly 1.2 seconds without resetting stats', () => {
  for (const type of ['offscreen', 'lava']) {
    const original = { ...createPet(START), happiness: 60, hidden: true, sleeping: true, paused: true, bond: 9 };
    const dead = applyPetEvent(original, physicalEvent(original, type), START).pet;
    const returnAt = START + DEATH_DELAY_MS;
    assert.equal(dead.stage, 'alive');
    assert.equal(dead.sleeping, false);
    assert.equal(dead.hidden, false);
    assert.equal(dead.paused, true);
    assert.equal(dead.lastDeath.face, 'displeased', 'face uses pre-loss happiness');
    assert.deepEqual(getPetPresence(dead, START), {
      state: 'absent', progress: 0, reason: type, face: null, token: 'gesture-1', remainingMs: DEATH_DELAY_MS,
    });
    assert.equal(getPetPresence(dead, returnAt - 1).remainingMs, 1);
    assert.deepEqual(getPetPresence(dead, returnAt), {
      state: 'falling', progress: 0, reason: type, face: 'displeased', token: 'gesture-1', remainingMs: RETURN_FALL_MS,
    });
    assert.equal(getPetPresence(dead, returnAt + 600).progress, 0.5);
    assert.equal(getPetPresence(dead, returnAt + RETURN_FALL_MS - 1).state, 'falling');
    assert.deepEqual(getPetPresence(dead, returnAt + RETURN_FALL_MS), {
      state: 'present', progress: 1, reason: null, face: null, token: null, remainingMs: 0,
    });
    const returned = advancePet(dead, returnAt + RETURN_FALL_MS);
    assert.equal(returned.generation, original.generation);
    assert.equal(returned.adoptedAt, original.adoptedAt);
    assert.equal(returned.bond, original.bond);
    assert.ok(Math.abs(returned.happiness - (dead.happiness - (DEATH_DELAY_MS + RETURN_FALL_MS) / MINUTE)) < 1e-9);
    assert.notEqual(returned.happiness, 100);
  }
});

test('deaths reaching zero arm immediately and absence never restarts or cancels doom', () => {
  for (const [type, happiness] of [['offscreen', 5], ['throw', 1]]) {
    const pet = { ...createPet(START), happiness };
    const dead = applyPetEvent(pet, physicalEvent(pet, type), START).pet;
    assert.equal(dead.happiness, 0);
    assert.equal(dead.stage, 'countdown');
    assert.equal(dead.stageStartedAt, START);
    for (const offset of [1000, DEATH_DELAY_MS, DEATH_DELAY_MS + RETURN_FALL_MS, COUNTDOWN_MS - 1]) {
      const next = advancePet(dead, START + offset);
      assert.equal(next.stageStartedAt, START);
      assert.equal(next.happiness, 0);
      assert.equal(claimPetScare(next, START + offset).scare, offset >= COUNTDOWN_MS);
    }
    assert.equal(claimPetScare(dead, START + COUNTDOWN_MS).scare, true);
    for (const eventType of ['throw', 'offscreen', 'lava', 'food']) {
      const result = applyPetEvent(dead, physicalEvent(dead, eventType, 'late', {
        stats: { fullness: 100, happiness: 100, energy: 100 },
      }), START + DEATH_DELAY_MS + RETURN_FALL_MS);
      assert.equal(result.accepted, false);
      assert.equal(result.pet.stageStartedAt, START);
      assert.equal(result.pet.happiness, 0);
    }
  }
  const almostZero = { ...createPet(START), happiness: 5.05 };
  const waiting = applyPetEvent(almostZero, physicalEvent(almostZero, 'offscreen'), START).pet;
  const zero = advancePet(waiting, START + DEATH_DELAY_MS);
  assert.equal(zero.stage, 'countdown');
  assert.ok(Math.abs(zero.stageStartedAt - (START + 3000)) < 0.001);
});

test('only present alive pets accept physical events and blocked care cannot bypass absence', () => {
  const pet = { ...createPet(START), happiness: 80 };
  const dead = applyPetEvent(pet, physicalEvent(pet, 'offscreen'), START).pet;
  for (const offset of [0, DEATH_DELAY_MS - 1, DEATH_DELAY_MS, DEATH_DELAY_MS + RETURN_FALL_MS - 1]) {
    const now = START + offset;
    const expected = advancePet(dead, now);
    for (const type of ['throw', 'offscreen', 'lava', 'food']) {
      const event = physicalEvent(dead, type, 'blocked', { stats: { fullness: 10, happiness: 10, energy: 10 } });
      assert.deepEqual(applyPetEvent(dead, event, now), { pet: expected, accepted: false });
    }
    for (const action of ['feed', 'play', 'pet', 'sleep']) assert.deepEqual(careForPet(dead, action, now), expected);
    assert.equal(careForPet(dead, 'hide', now).hidden, true);
    assert.equal(careForPet({ ...dead, hidden: true }, 'show', now).hidden, false);
    assert.equal(careForPet(dead, 'pause', now).paused, true);
  }
  const now = START + DEATH_DELAY_MS + RETURN_FALL_MS;
  assert.equal(applyPetEvent(dead, physicalEvent(dead, 'throw', 'returned'), now).accepted, true);
  assert.equal(careForPet(dead, 'sleep', now).sleeping, true);
});

test('food is the only feeding path and uses validated bounded catalog boosts', () => {
  const pet = Object.freeze({ ...createPet(START), fullness: 91, happiness: 70.5, energy: 5 });
  assert.deepEqual(careForPet(pet, 'feed', START), pet);
  const event = physicalEvent(pet, 'food', 'food-1', { stats: { fullness: 25, happiness: 10, energy: 100 } });
  const result = applyPetEvent(pet, event, START);
  assert.equal(result.accepted, true);
  assert.deepEqual(stats(result.pet), [100, 80.5, 100, 1]);
  assert.equal(result.pet.lastDeath, null);
  assert.equal(getPetLifeToken(result.pet), getPetLifeToken(pet));
  const zero = physicalEvent(pet, 'food', 'food-zero', { stats: { fullness: 0, happiness: 0, energy: 0 } });
  assert.deepEqual(stats(applyPetEvent(pet, zero, START).pet), [91, 70.5, 5, 1]);
  for (const bad of [undefined, null, [], {}, { fullness: 1, happiness: 2 },
    { fullness: 1, happiness: 2, energy: 3, bond: 5 },
    ...[-1, 101, 0.5, NaN, Infinity, '3', null].map(fullness => ({ fullness, happiness: 2, energy: 3 }))]) {
    assert.deepEqual(applyPetEvent(pet, { ...event, stats: bad }, START), { pet, accepted: false });
  }
  const maxBond = { ...pet, bond: Number.MAX_SAFE_INTEGER };
  assert.equal(applyPetEvent(maxBond, event, START).pet.bond, Number.MAX_SAFE_INTEGER);
});

test('event validation, bounded deduplication and life identities reject stale callbacks', () => {
  let pet = createPet(START);
  const token = getPetLifeToken(pet);
  assert.equal(token, `1:${START}:initial`);
  assert.equal(getPetLifeToken(null), null);
  for (const event of [null, [], {}, { id: 'x', token, type: 'feed' },
    ...['', ' ', 'x'.repeat(101), 1, null].map(id => ({ id, token, type: 'throw' })),
    { id: 'x', token: 'stale', type: 'throw' }]) {
    assert.deepEqual(applyPetEvent(pet, event, START), { pet, accepted: false });
  }
  assert.deepEqual(applyPetEvent(null, { id: 'x', token, type: 'throw' }, START), { pet: null, accepted: false });
  for (let i = 0; i < 40; i++) {
    const event = { id: `drag-${i}`, token, type: 'throw' };
    const result = applyPetEvent(pet, event, START);
    assert.equal(result.accepted, true);
    pet = result.pet;
    assert.equal(applyPetEvent(pet, event, START).accepted, false);
  }
  assert.equal(pet.happiness, 60);
  assert.equal(pet.recentEventIds.length, 32);
  assert.equal(pet.recentEventIds[0], 'drag-8');
  const event = { id: 'death-1', token, type: 'lava' };
  const dead = applyPetEvent(pet, event, START).pet;
  const now = START + DEATH_DELAY_MS + RETURN_FALL_MS;
  assert.equal(applyPetEvent(dead, { id: 'old-gesture', token, type: 'offscreen' }, now).accepted, false);
  assert.equal(applyPetEvent(dead, physicalEvent(dead, 'lava', 'death-1'), now).accepted, false);
  assert.equal(getPetLifeToken(dead), `1:${START}:death-1`);
});

test('death comments are consumed once at return, persist the reason, and never mutate their input', () => {
  for (const type of ['lava', 'offscreen']) {
    const original = createPet(START);
    const dead = applyPetEvent(original, physicalEvent(original, type), START).pet;
    assert.equal(takeDeathComment(dead, START + DEATH_DELAY_MS - 1).reason, null);
    const result = takeDeathComment(Object.freeze(dead), START + DEATH_DELAY_MS);
    assert.equal(result.reason, type);
    assert.equal(result.pet.lastDeath.announced, true);
    assert.equal(dead.lastDeath.announced, false);
    assert.equal(result.pet.lastDeath.reason, type);
    assert.equal(getPetLifeToken(result.pet), getPetLifeToken(dead));
    assert.equal(takeDeathComment(result.pet, START + DEATH_DELAY_MS + RETURN_FALL_MS).reason, null);
    const storage = memoryStorage();
    assert.equal(savePet(storage, result.pet), true);
    assert.equal(takeDeathComment(loadPet(storage, START + DEATH_DELAY_MS), START + DEATH_DELAY_MS).reason, null);
  }
  assert.deepEqual(takeDeathComment(null, START), { pet: null, reason: null });
  assert.equal(takeDeathComment(createPet(START), START).reason, null);
});

test('monster return retains zero during recovery and rejects old gestures across the fresh falling generation', () => {
  const initial = { ...createPet(START), happiness: 1, paused: true, sleeping: true, hidden: true };
  const oldToken = getPetLifeToken(initial);
  const claimedAt = START + 2 * MINUTE;
  const claimed = claimPetScare(initial, claimedAt).pet;
  const returnAt = claimedAt + DEATH_DELAY_MS;
  assert.equal(claimed.lastDeath.at, claimedAt);
  assert.equal(claimed.lastDeath.reason, 'monster');
  assert.equal(claimed.lastDeath.face, 'abandoned');
  assert.equal(getPetPresence(claimed, claimedAt).state, 'absent');
  assert.equal(claimed.hidden, false);
  assert.equal(claimed.sleeping, false);
  const recovering = finishPetScare(claimed, getScareToken(claimed), claimedAt + 1000);
  assert.equal(recovering.happiness, 0);
  assert.equal(getPetPresence(recovering, returnAt - 1).state, 'absent');
  assert.equal(takeDeathComment(recovering, returnAt - 1).reason, null);
  const returnComment = takeDeathComment(recovering, returnAt + 5000);
  const fresh = returnComment.pet;
  assert.equal(returnComment.reason, 'monster');
  assert.equal(fresh.stage, 'forming');
  assert.equal(fresh.generation, 2);
  assert.equal(fresh.stageStartedAt, returnAt + 5000, 'late formation starts now, not at the old deadline');
  assert.equal(fresh.paused, true);
  assert.equal(fresh.hidden, false);
  assert.equal(fresh.sleeping, false);
  assert.deepEqual(stats(fresh), [80, 100, 90, 0]);
  assert.equal(getPetPresence(fresh, fresh.stageStartedAt).face, 'abandoned');
  assert.equal(getPetPresence(fresh, fresh.stageStartedAt).progress, 0);
  assert.equal(takeDeathComment(fresh, fresh.stageStartedAt + 100).reason, null);
  for (const offset of [0, RETURN_FALL_MS]) {
    assert.equal(applyPetEvent(fresh, { id: 'old-callback', token: oldToken, type: 'lava' }, fresh.stageStartedAt + offset).accepted, false);
  }
  assert.equal(applyPetEvent(fresh, physicalEvent(fresh, 'throw', 'new-gesture'), fresh.stageStartedAt).accepted, false);
  assert.equal(applyPetEvent(fresh, physicalEvent(fresh, 'throw', 'new-gesture'), fresh.stageStartedAt + RETURN_FALL_MS).accepted, true);
  assert.equal(getPetPresence(fresh, fresh.stageStartedAt + RETURN_FALL_MS).face, null);
});

test('version three migration preserves lifecycle identity, with safe monster recovery metadata', () => {
  for (const stage of ['alive', 'countdown', 'scaring', 'forming']) {
    const legacy = { ...createPet(START), version: 3, generation: 9, stage, happiness: stage === 'alive' ? 55 : 0 };
    delete legacy.lastDeath;
    delete legacy.recentEventIds;
    const migrated = normalizePet(legacy, START);
    assert.equal(migrated.version, 4);
    assert.equal(migrated.generation, 9);
    assert.equal(migrated.stage, stage);
    assert.equal(migrated.stageStartedAt, START);
    assert.deepEqual(migrated.recentEventIds, []);
    if (stage === 'scaring') {
      assert.equal(migrated.lastDeath.reason, 'monster');
      assert.equal(migrated.lastDeath.returnAt, START + DEATH_DELAY_MS);
      assert.equal(advancePet(migrated, START + SCARE_LEASE_MS).stage, 'recovering');
      assert.equal(advancePet(migrated, START + DEATH_DELAY_MS).generation, 10);
    } else assert.equal(migrated.lastDeath, null);
  }
});

test('death metadata normalization is bounded, strips extras and derives its deadline', () => {
  const base = createPet(START);
  const lastDeath = { id: 'saved-death', reason: 'lava', at: START, returnAt: 0, face: 'angry', announced: true, extra: true };
  const normalized = normalizePet({ ...base, lastDeath, recentEventIds: [null, '', ' ', 1, 'a', 'a', 'b', 'x'.repeat(101)] }, START);
  assert.deepEqual(normalized.lastDeath, {
    id: 'saved-death', reason: 'lava', at: START, returnAt: START + DEATH_DELAY_MS, face: 'angry', announced: true,
  });
  assert.deepEqual(normalized.recentEventIds, ['a', 'b']);
  for (const bad of [null, [], {}, { ...lastDeath, id: '' }, { ...lastDeath, id: 'x'.repeat(101) },
    { ...lastDeath, reason: 'unknown' }, { ...lastDeath, at: -1 }, { ...lastDeath, at: NaN },
    { ...lastDeath, face: 'bad' }]) {
    assert.equal(normalizePet({ ...base, lastDeath: bad }, START).lastDeath, null);
  }
  const many = normalizePet({ ...base, recentEventIds: Array.from({ length: 100 }, (_, i) => `event-${i}`) }, START);
  assert.equal(many.recentEventIds.length, 32);
  assert.equal(many.recentEventIds[0], 'event-68');
  const storage = memoryStorage(JSON.stringify(normalized));
  assert.deepEqual(loadPet(storage, START).lastDeath, normalized.lastDeath);
  assert.deepEqual(loadPet(storage, START).recentEventIds, ['a', 'b']);
});
