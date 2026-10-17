import assert from "node:assert/strict";
import test from "node:test";
import { ComponentType, type User } from "discord.js";
import { loadConfig } from "../src/config.js";
import {
  buildAnswerModal,
  buildResponseEmbed,
  parseRating,
  readCheckupAnswers,
} from "../src/questionnaire.js";
import { type CheckupRecord } from "../src/checkupStore.js";

const record: CheckupRecord = {
  id: "test-checkup-1234",
  guildId: "123456789012345678",
  channelId: "234567890123456789",
  messageId: "345678901234567890",
  partnerRoleId: "456789012345678901",
  responseChannelId: "567890123456789012",
  period: "🎉".repeat(20),
  createdAt: Date.now(),
  closedAt: null,
  responses: {},
};
const config = loadConfig({
  DISCORD_TOKEN: "test",
  DISCORD_CLIENT_ID: record.guildId,
  DISCORD_GUILD_IDS: record.guildId,
  CUSTOM_ID_SECRET: "only-for-tests-abcdefghijklmnopqrstuvwxyz",
});

test("the modal uses current Label components and a required, unselected 1–5 dropdown after feedback", () => {
  const modal = buildAnswerModal(record, config).toJSON();
  assert.ok(modal.custom_id.length <= 100);
  assert.equal(modal.components.length, 4);
  assert.ok(
    modal.components.every(
      (component) => component.type === ComponentType.Label,
    ),
  );
  const feedback = modal.components[2];
  const rating = modal.components[3];
  assert.equal(
    feedback?.type === ComponentType.Label && feedback.component.custom_id,
    "feedback",
  );
  assert.ok(
    rating?.type === ComponentType.Label &&
      rating.component.type === ComponentType.StringSelect,
  );
  if (
    rating?.type !== ComponentType.Label ||
    rating.component.type !== ComponentType.StringSelect
  )
    return;
  assert.equal(rating.component.required, true);
  assert.equal(rating.component.min_values, 1);
  assert.equal(rating.component.max_values, 1);
  assert.deepEqual(
    rating.component.options.map((option) => option.value),
    ["1", "2", "3", "4", "5"],
  );
  assert.ok(rating.component.options.every((option) => !option.default));
});

test("missing, multi-value and forged star ratings are rejected server-side", () => {
  for (const values of [[], ["0"], ["6"], ["3.5"], ["5x"], [" 5"], ["1", "5"]])
    assert.equal(parseRating(values), null);
  assert.equal(parseRating(["1"]), 1);
  assert.equal(parseRating(["5"]), 5);
  assert.equal(
    readCheckupAnswers({
      getTextInputValue: () => "   ",
      getStringSelectValues: () => ["5"],
    }),
    null,
  );
  assert.equal(
    readCheckupAnswers({
      getTextInputValue: () => "Okay",
      getStringSelectValues: () => {
        throw new Error("Missing field");
      },
    }),
    null,
  );
});

test("maximum-length feedback with repeated backticks stays within Discord embed limits", () => {
  const user = {
    id: "678901234567890123",
    displayName: "Example",
    displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
  } as unknown as User;
  const embed = buildResponseEmbed(
    record,
    {
      announcements: "`".repeat(1000),
      events: "x".repeat(1000),
      feedback: "y".repeat(1000),
      rating: 4,
    },
    user,
    record.messageId,
  ).toJSON();
  for (const field of embed.fields ?? []) assert.ok(field.value.length <= 1024);
  assert.equal(
    embed.fields?.find((field) => field.name === "Partnership rating")?.value,
    "★★★★☆ · 4/5",
  );
  assert.ok(
    (embed.fields ?? []).reduce(
      (size, field) => size + field.name.length + field.value.length,
      0,
    ) < 5500,
  );
});
