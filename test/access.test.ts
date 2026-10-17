import assert from "node:assert/strict";
import test from "node:test";
import {
  PermissionFlagsBits,
  PermissionsBitField,
  type GuildMember,
} from "discord.js";
import { canManageBot, canOperateBot } from "../src/access.js";
import { AllowedRoleStore } from "../src/allowedRoleStore.js";
import { commandAccessLevel } from "../src/index.js";

const owner = "123456789012345678";
const member = (id: string, admin = false) =>
  ({
    id,
    guild: { id: "234567890123456789", ownerId: owner },
    permissions: new PermissionsBitField(
      admin ? PermissionFlagsBits.Administrator : 0n,
    ),
    roles: { cache: new Map() },
  }) as unknown as GuildMember;
const store = new AllowedRoleStore("/unused-test-path");

test("the server owner and Discord administrators can always manage and operate the bot", () => {
  for (const user of [member(owner), member("345678901234567890", true)]) {
    assert.equal(canManageBot(user, store), true);
    assert.equal(canOperateBot(user, store), true);
  }
  assert.equal(canManageBot(member("345678901234567890"), store), false);
  assert.equal(canOperateBot(member("345678901234567890"), store), false);
});

test("permission changes and log configuration require manager access; ordinary commands do not", () => {
  for (const name of ["allowed-role", "allowed-user"]) {
    assert.equal(commandAccessLevel(name, "add"), "manager");
    assert.equal(commandAccessLevel(name, "remove"), "manager");
    assert.equal(commandAccessLevel(name, "list"), "operator");
  }
  for (const sub of ["log-channel", "disable-logs", "test-log"])
    assert.equal(commandAccessLevel("bot-settings", sub), "manager");
  assert.equal(commandAccessLevel("bot-settings", "show"), "operator");
  assert.equal(commandAccessLevel("weekly-checkup", null), "operator");
  assert.equal(commandAccessLevel("user-info", null), "operator");
  assert.equal(commandAccessLevel("unexpected-command", null), null);
});
