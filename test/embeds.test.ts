import assert from "node:assert/strict";
import test from "node:test";

import { errorEmbed, successEmbed } from "../src/embeds.js";
import {
  buildQuestionnaireEmbed,
  defaultPeriod,
} from "../src/weeklyCheckup.js";

test("standard response embeds include branding and a timestamp", () => {
  const success = successEmbed("Completed", "The action succeeded.").toJSON();
  const error = errorEmbed("Failed", "The action failed.").toJSON();

  assert.equal(success.title, "Completed");
  assert.equal(success.description, "The action succeeded.");
  assert.equal(success.footer?.text, "Glixera | Affiliate Services");
  assert.equal(typeof success.timestamp, "string");
  assert.notEqual(success.color, error.color);
});

test("weekly questionnaire embeds deliberately omit the timestamp", () => {
  const questionnaire = buildQuestionnaireEmbed(
    "Week of 17–23 Aug 2026",
    "Test Manager",
  ).toJSON();

  assert.equal(
    questionnaire.title,
    "Weekly Partnership Checkup • Week of 17–23 Aug 2026",
  );
  assert.equal("timestamp" in questionnaire, false);
});

test("weekly periods use Monday through Sunday in the configured time zone", () => {
  assert.equal(
    defaultPeriod("Europe/Brussels", new Date("2026-08-16T22:30:00Z")),
    "Week of 17–23 Aug 2026",
  );
  assert.equal(
    defaultPeriod("Europe/Brussels", new Date("2026-12-31T12:00:00Z")),
    "Week of 28 Dec 2026–3 Jan 2027",
  );
});
