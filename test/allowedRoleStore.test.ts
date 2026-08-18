import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AllowedRoleStore } from "../src/allowedRoleStore.js";

const guildOne = "123456789012345678";
const guildTwo = "234567890123456789";
const fallbackRole = "345678901234567890";
const persistentRoleOne = "456789012345678901";
const persistentRoleTwo = "567890123456789012";

async function createTemporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "glixera-affiliate-test-"));
}

test("persistent roles survive a store restart and remain guild-specific", async () => {
  const directory = await createTemporaryDirectory();

  try {
    const firstStore = new AllowedRoleStore(directory, [fallbackRole]);
    await firstStore.initialize();

    assert.equal(
      await firstStore.addPersistentRole(guildOne, persistentRoleOne),
      "added",
    );
    assert.deepEqual(firstStore.getSnapshot(guildOne).allRoleIds, [
      fallbackRole,
      persistentRoleOne,
    ]);
    assert.deepEqual(firstStore.getSnapshot(guildTwo).allRoleIds, [fallbackRole]);

    const restartedStore = new AllowedRoleStore(directory, [fallbackRole]);
    await restartedStore.initialize();

    assert.deepEqual(restartedStore.getSnapshot(guildOne).persistentRoleIds, [
      persistentRoleOne,
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fallback roles cannot be added to or removed from persistent storage", async () => {
  const directory = await createTemporaryDirectory();

  try {
    const store = new AllowedRoleStore(directory, [fallbackRole]);
    await store.initialize();

    assert.equal(await store.addPersistentRole(guildOne, fallbackRole), "fallback");
    assert.equal(await store.removePersistentRole(guildOne, fallbackRole), "fallback");
    assert.deepEqual(store.getSnapshot(guildOne).fallbackRoleIds, [fallbackRole]);
    assert.deepEqual(store.getSnapshot(guildOne).persistentRoleIds, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent role additions are serialized without losing data", async () => {
  const directory = await createTemporaryDirectory();

  try {
    const store = new AllowedRoleStore(directory, [fallbackRole]);
    await store.initialize();

    await Promise.all([
      store.addPersistentRole(guildOne, persistentRoleOne),
      store.addPersistentRole(guildOne, persistentRoleTwo),
    ]);

    assert.deepEqual(store.getSnapshot(guildOne).persistentRoleIds, [
      persistentRoleOne,
      persistentRoleTwo,
    ]);

    const stored = JSON.parse(
      await readFile(join(directory, "allowed-roles.json"), "utf8"),
    ) as { guilds: Record<string, string[]> };
    assert.deepEqual(stored.guilds[guildOne], [persistentRoleOne, persistentRoleTwo]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
