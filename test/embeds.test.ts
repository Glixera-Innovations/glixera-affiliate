import assert from "node:assert/strict";
import test from "node:test";

import { errorEmbed, successEmbed } from "../src/embeds.js";
import { buildQuestionnaireEmbed } from "../src/monthlyCheckup.js";

test("standard response embeds include branding and a timestamp", () => {
  const success = successEmbed("Completed", "The action succeeded.").toJSON();
  const error = errorEmbed("Failed", "The action failed.").toJSON();

  assert.equal(success.title, "Completed");
  assert.equal(success.description, "The action succeeded.");
  assert.equal(success.footer?.text, "Glixera | Affiliate Services");
  assert.equal(typeof success.timestamp, "string");
  assert.notEqual(success.color, error.color);
});

test("monthly questionnaire embeds deliberately omit the timestamp", () => {
  const questionnaire = buildQuestionnaireEmbed(
    "August 2026",
    "Test Manager",
  ).toJSON();

  assert.equal(questionnaire.title, "Monthly Partnership Checkup • August 2026");
  assert.equal("timestamp" in questionnaire, false);
});
