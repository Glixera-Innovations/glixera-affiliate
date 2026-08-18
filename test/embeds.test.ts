import assert from "node:assert/strict";
import test from "node:test";

import { errorEmbed, successEmbed } from "../src/embeds.js";

test("standard response embeds include branding without a timestamp", () => {
  const success = successEmbed("Completed", "The action succeeded.").toJSON();
  const error = errorEmbed("Failed", "The action failed.").toJSON();

  assert.equal(success.title, "Completed");
  assert.equal(success.description, "The action succeeded.");
  assert.equal(success.footer?.text, "Glixera • Affiliate Services");
  assert.equal("timestamp" in success, false);
  assert.notEqual(success.color, error.color);
});
