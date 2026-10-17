import assert from "node:assert/strict";
import test from "node:test";
import type { User } from "discord.js";
import { buildUserInfoEmbed } from "../src/userInfo.js";
import { AllowedRoleStore } from "../src/allowedRoleStore.js";

const user = {
  id: "123456789012345678",
  username: "example_user",
  displayName: "Example",
  createdTimestamp: 1700000000000,
  bot: false,
  accentColor: 0x5865f2,
  displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
  bannerURL: () => "https://cdn.discordapp.com/banners/example.png",
} as unknown as User;

test("user lookup provides account details, profile link, avatar and banner without privileged data", () => {
  const embed = buildUserInfoEmbed(
    user,
    null,
    new AllowedRoleStore("/unused"),
  ).toJSON();
  assert.equal(embed.thumbnail?.url, user.displayAvatarURL());
  assert.equal(embed.image?.url, user.bannerURL());
  assert.ok(
    embed.description?.includes(`https://discord.com/users/${user.id}`),
  );
  assert.ok(
    embed.fields?.some(
      (field) =>
        field.name === "Server membership" &&
        field.value.includes("Not a member"),
    ),
  );
  assert.ok(!JSON.stringify(embed).includes("email"));
  assert.ok(!JSON.stringify(embed).includes("presence"));
});
