import assert from "node:assert/strict";
import test from "node:test";

import {
  createCheckupCustomId,
  isCheckupCustomId,
  parseCheckupCustomId,
  type CheckupContext,
} from "../src/customIds.js";

const secret = "a-development-only-secret-with-32-characters";
const context: CheckupContext = {
  partnerRoleId: "123456789012345678",
  responseChannelId: "234567890123456789",
  period: "Week of 17–23 Aug 2026",
};

test("signed checkup IDs round-trip", () => {
  const customId = createCheckupCustomId("answer", context, secret);

  assert.deepEqual(parseCheckupCustomId(customId, secret), {
    action: "answer",
    ...context,
  });
  assert.equal(customId.startsWith("wcq:"), true);
  assert.ok(customId.length <= 100);
});

test("legacy monthly controls are routed to the invalid-control response", () => {
  assert.equal(isCheckupCustomId("mcq:1:a:legacy"), true);
  assert.equal(parseCheckupCustomId("mcq:1:a:legacy", secret), null);
});

test("tampered checkup IDs are rejected", () => {
  const customId = createCheckupCustomId("submit", context, secret);
  const tampered = customId.replace(context.partnerRoleId, "123456789012345679");

  assert.equal(parseCheckupCustomId(tampered, secret), null);
  assert.equal(parseCheckupCustomId(customId, `${secret}-wrong`), null);
});

test("invalid Discord IDs cannot be encoded", () => {
  assert.throws(() =>
    createCheckupCustomId(
      "close",
      {
        ...context,
        partnerRoleId: "not-a-role",
      },
      secret,
    ),
  );
});
