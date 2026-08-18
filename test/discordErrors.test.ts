import assert from "node:assert/strict";
import test from "node:test";

import { isDiscordMissingAccessError } from "../src/discordErrors.js";

test("Discord Missing Access errors are recognized", () => {
  assert.equal(isDiscordMissingAccessError({ code: 50_001 }), true);
  assert.equal(isDiscordMissingAccessError({ code: "50001" }), true);
});

test("unrelated or malformed errors are not treated as Missing Access", () => {
  assert.equal(isDiscordMissingAccessError({ code: 50_013 }), false);
  assert.equal(isDiscordMissingAccessError(new Error("Missing Access")), false);
  assert.equal(isDiscordMissingAccessError(null), false);
});
