import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AllowedRoleStore } from "../src/allowedRoleStore.js";

const guild = "123456789012345678";
const otherGuild = "234567890123456789";
const role = "345678901234567890";
const user = "456789012345678901";

async function withStore(
  run: (store: AllowedRoleStore, directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "glixera-access-"));
  try {
    const store = new AllowedRoleStore(directory);
    await store.initialize([guild]);
    await run(store, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("roles, individual users, manager access and logs persist separately per server", async () =>
  withStore(async (store, directory) => {
    await store.setAccess(guild, "role", role, "operator");
    await store.setAccess(guild, "user", user, "manager");
    await store.setLogChannel(guild, role);
    const restarted = new AllowedRoleStore(directory);
    await restarted.initialize([guild, otherGuild]);
    assert.equal(
      restarted.hasAccess(guild, "999999999999999999", new Set([role])),
      true,
    );
    assert.equal(restarted.hasManager(guild, user, new Set()), true);
    assert.equal(restarted.hasAccess(otherGuild, user, new Set([role])), false);
    assert.equal(restarted.getSnapshot(guild).logChannelId, role);
    assert.equal(restarted.getSnapshot(otherGuild).logChannelId, null);
  }));

test("0.2.x files migrate and legacy environment roles are imported only once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glixera-migration-"));
  try {
    await writeFile(
      join(directory, "allowed-roles.json"),
      JSON.stringify({ version: 1, guilds: { [guild]: [user] } }),
    );
    const store = new AllowedRoleStore(directory, [role]);
    await store.initialize([guild]);
    assert.deepEqual(store.getSnapshot(guild).roleIds, [user]);
    assert.deepEqual(store.getSnapshot(guild).managerRoleIds, [role]);
    assert.equal(await store.removeAccess(guild, "role", role), true);
    const restarted = new AllowedRoleStore(directory, [role]);
    await restarted.initialize([guild]);
    assert.deepEqual(restarted.getSnapshot(guild).managerRoleIds, []);
    assert.deepEqual(restarted.getSnapshot(guild).roleIds, [user]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent changes are not lost and promoting/demoting replaces the prior access level", async () =>
  withStore(async (store, directory) => {
    await Promise.all([
      store.setAccess(guild, "role", role, "operator"),
      store.setAccess(guild, "user", user, "operator"),
      store.setLogChannel(guild, role),
    ]);
    await store.setAccess(guild, "role", role, "manager");
    assert.deepEqual(store.getSnapshot(guild).roleIds, []);
    assert.equal(store.hasManager(guild, user, new Set([role])), true);
    await store.setAccess(guild, "role", role, "operator");
    assert.equal(store.hasManager(guild, user, new Set([role])), false);
    const saved = JSON.parse(
      await readFile(join(directory, "allowed-roles.json"), "utf8"),
    );
    assert.deepEqual(saved.guilds[guild].userIds, [user]);
    const snapshot = store.getSnapshot(guild);
    snapshot.roleIds.push(user);
    assert.deepEqual(store.getSnapshot(guild).roleIds, [role]);
  }));

test("corrupt permission files are preserved and fail startup rather than resetting access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "glixera-corrupt-"));
  try {
    const path = join(directory, "allowed-roles.json");
    await writeFile(path, "{broken");
    await assert.rejects(
      new AllowedRoleStore(directory).initialize([guild]),
      /Restore a valid backup/,
    );
    assert.equal(await readFile(path, "utf8"), "{broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
