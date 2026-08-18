import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

const baseEnvironment: NodeJS.ProcessEnv = {
  DISCORD_TOKEN: "development-token",
  DISCORD_CLIENT_ID: "123456789012345678",
  ALLOWED_ROLE_IDS: "234567890123456789",
  CUSTOM_ID_SECRET: "a-development-only-secret-with-32-characters",
};

test("multiple guild IDs are parsed and deduplicated", () => {
  const config = loadConfig({
    ...baseEnvironment,
    DISCORD_GUILD_IDS: "345678901234567890,456789012345678901,345678901234567890",
  });

  assert.deepEqual(config.guildIds, [
    "345678901234567890",
    "456789012345678901",
  ]);
});

test("the legacy single guild variable remains supported", () => {
  const config = loadConfig({
    ...baseEnvironment,
    DISCORD_GUILD_ID: "345678901234567890",
  });

  assert.deepEqual(config.guildIds, ["345678901234567890"]);
});

test("Europe/Brussels and local data storage are safe defaults", () => {
  const config = loadConfig({
    ...baseEnvironment,
    DISCORD_GUILD_IDS: "345678901234567890",
  });

  assert.equal(config.timeZone, "Europe/Brussels");
  assert.equal(config.dataDirectory, "./data");
});
