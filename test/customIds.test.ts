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
  const tampered = customId.replace(
    context.partnerRoleId,
    "123456789012345679",
  );

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

test("stored controls have bounded length and are signed for their originating guild", async () => {
  const { createStoredCheckupCustomId, parseStoredCheckupCustomId } =
    await import("../src/customIds.js");
  const id = createStoredCheckupCustomId(
    "submit",
    context.partnerRoleId,
    "test-checkup-1234",
    secret,
  );
  assert.ok(id.length <= 100);
  assert.deepEqual(parseStoredCheckupCustomId(id, secret), {
    action: "submit",
    guildId: context.partnerRoleId,
    checkupId: "test-checkup-1234",
  });
  assert.equal(
    parseStoredCheckupCustomId(
      id.replace(context.partnerRoleId, "345678901234567890"),
      secret,
    ),
    null,
  );
  assert.equal(
    parseStoredCheckupCustomId(
      id.replace("test-checkup-1234", "test-checkup-5678"),
      secret,
    ),
    null,
  );
  assert.equal(parseStoredCheckupCustomId(id, secret + "wrong"), null);
});
