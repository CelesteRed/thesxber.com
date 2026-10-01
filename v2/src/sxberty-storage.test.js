import test from "node:test";
import assert from "node:assert/strict";
import { readLatestPet, withPetLock } from "./sxberty-storage.js";
import {
  advancePet, careForPet, claimPetScare, createPet, finishPetScare, getScareToken,
  savePet, COUNTDOWN_MS, SCARE_LEASE_MS, SXBERTY_STORAGE_KEY,
} from "./verity-pet.js";

function fakeLocks() {
  let queue = Promise.resolve();
  const names = [];
  return {
    names,
    request(name, action) {
      names.push(name);
      const result = queue.then(action);
      queue = result.catch(() => {});
      return result;
    }
  };
}

test("two active tabs claim an overdue countdown only once under the origin-wide lock", async () => {
  const now = 101 * 60_000;
  let serialized = JSON.stringify(advancePet(createPet(0), now));
  const storage = {
    getItem: () => serialized,
    setItem: (key, value) => { assert.equal(key, SXBERTY_STORAGE_KEY); serialized = value; },
  };
  const locks = fakeLocks();
  const claim = () => withPetLock(async () => {
    const snapshot = readLatestPet(storage, null);
    await Promise.resolve();
    const { pet, scare } = claimPetScare(snapshot, now);
    assert.equal(savePet(storage, pet), true);
    return scare;
  }, locks);
  const result = await Promise.all([claim(), claim()]);
  assert.deepEqual(result, [true, false]);
  assert.equal(JSON.parse(serialized).stage, "scaring");
  assert.equal(JSON.parse(serialized).generation, 1);
  assert.ok(locks.names.every(name => name === `${SXBERTY_STORAGE_KEY}:write`));
});

test("a serialized tick cannot put a claimed countdown back in storage", async () => {
  const now = 101 * 60_000;
  let persisted = advancePet(createPet(0), now);
  const locks = fakeLocks();
  const [claimed] = await Promise.all([
    withPetLock(() => { const claim = claimPetScare(persisted, now); persisted = claim.pet; return claim.scare; }, locks),
    withPetLock(() => { persisted = advancePet(persisted, now + 1000); }, locks)
  ]);
  assert.equal(claimed, true);
  assert.equal(persisted.stage, "scaring");
  assert.equal(persisted.stageStartedAt, now);
  assert.equal(claimPetScare(persisted, now + 2000).scare, false);
});

test("serialized lease recovery and a delayed owner callback create only one new generation", async () => {
  const now = 101 * 60_000;
  let persisted = claimPetScare(createPet(0), now).pet;
  const token = getScareToken(persisted);
  const locks = fakeLocks();
  const recoveredAt = now + SCARE_LEASE_MS;
  await Promise.all([
    withPetLock(() => { persisted = advancePet(persisted, recoveredAt); }, locks),
    withPetLock(() => { persisted = finishPetScare(persisted, token, recoveredAt + 1); }, locks),
  ]);
  assert.equal(persisted.generation, 2);
  assert.equal(persisted.stage, "forming");
  assert.equal(persisted.adoptedAt, recoveredAt);
  assert.equal(persisted.stageStartedAt, recoveredAt);
  assert.equal(claimPetScare(persisted, recoveredAt + 2).scare, false);
});

test("blocked Web Locks fall back without losing in-memory care", async () => {
  let calls = 0;
  const locks = { request: async () => { throw new Error("Permission denied"); } };
  assert.equal(await withPetLock(() => ++calls, locks), 1);
  assert.equal(calls, 1);
});

test("action failure does not repeat a mutation through the fallback", async () => {
  let calls = 0;
  await assert.rejects(withPetLock(() => { calls++; throw new Error("action failed"); }, fakeLocks()), /action failed/);
  assert.equal(calls, 1);
});

test("document fallback queues mutations and recovers after a rejection", async () => {
  const values = [];
  const first = withPetLock(async () => { await Promise.resolve(); values.push(1); }, null);
  const second = withPetLock(() => { values.push(2); throw new Error("expected"); }, null);
  const third = withPetLock(() => values.push(3), null);
  await first;
  await assert.rejects(second, /expected/);
  await third;
  assert.deepEqual(values, [1, 2, 3]);
});

test("an advanced hydration timestamp never outranks a persisted scare claim", async () => {
  const now = 101 * 60_000;
  const countdown = advancePet(createPet(0), now);
  const hydrated = advancePet(countdown, now + 1);
  const claimed = claimPetScare(countdown, now).pet;
  const storage = { getItem: () => JSON.stringify(claimed) };
  const latest = await withPetLock(() => readLatestPet(storage, hydrated), fakeLocks());
  assert.equal(latest.updatedAt, now);
  assert.equal(latest.stage, "scaring");
  assert.equal(claimPetScare(latest, now + 2).scare, false);
});

test("failed persistence preserves in-memory care rather than reverting to old storage", () => {
  const memory = { ...createPet(100), happiness: 90 };
  const storage = { getItem: () => JSON.stringify({ ...memory, happiness: 10 }) };
  assert.equal(readLatestPet(storage, memory, true), memory);
  assert.equal(readLatestPet(null, memory), memory);
  assert.equal(readLatestPet({ getItem() { throw new Error("blocked"); } }, memory), memory);
  assert.equal(readLatestPet({ getItem: () => "broken" }, memory), memory);
});

test("a cleared persisted pet is not resurrected by a stale document", () => {
  assert.equal(readLatestPet({ getItem: () => null }, createPet()), null);
});

test("denied storage and Web Locks retain the full in-memory lifecycle and paused preference", async () => {
  const storage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  const locks = { request: async () => { throw new Error("denied"); } };
  let memory = careForPet({ ...createPet(0), happiness: 0 }, "pause", 0);
  let preferMemory = false;
  const mutate = action => withPetLock(() => {
    memory = action(readLatestPet(storage, memory, preferMemory));
    preferMemory = !savePet(storage, memory);
    return memory;
  }, locks);
  await mutate(pet => advancePet(pet, COUNTDOWN_MS - 1));
  assert.equal(memory.stage, "countdown");
  assert.equal(memory.stageStartedAt, 0);
  let scares = 0;
  const claim = pet => {
    const result = claimPetScare(pet, COUNTDOWN_MS);
    scares += Number(result.scare);
    return result.pet;
  };
  await Promise.all([mutate(claim), mutate(claim)]);
  assert.equal(scares, 1);
  const token = getScareToken(memory);
  await mutate(pet => finishPetScare(pet, token, COUNTDOWN_MS + 1000));
  assert.equal(memory.generation, 2);
  assert.equal(memory.stage, "forming");
  assert.equal(memory.paused, true);
  assert.equal(memory.hidden, false);
  assert.equal(memory.happiness, 100);
  assert.equal(preferMemory, true);
});
