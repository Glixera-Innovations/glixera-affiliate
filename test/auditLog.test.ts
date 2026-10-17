import assert from "node:assert/strict";
import test from "node:test";
import { ChannelType, type Client, type User } from "discord.js";
import { AllowedRoleStore } from "../src/allowedRoleStore.js";
import { AuditLogger } from "../src/auditLog.js";
import { describeError } from "../src/errors.js";

const guild = "123456789012345678";
const channelId = "234567890123456789";

test("logging is off by default and causes no Discord requests", async () => {
  const logger = new AuditLogger(
    { guilds: { cache: new Map() } } as unknown as Client,
    new AllowedRoleStore("/unused"),
  );
  assert.equal(
    await logger.record(guild, { title: "Test", description: "Metadata" }),
    false,
  );
});

test("usage logs show actor metadata and suppress mentions", async () => {
  let payload:
    | {
        allowedMentions: unknown;
        embeds: {
          toJSON(): {
            author?: { name: string };
            fields?: { name: string; value: string }[];
          };
        }[];
      }
    | undefined;
  const channel = {
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has: () => true }),
    send: async (value: typeof payload) => {
      payload = value;
    },
  };
  const client = {
    guilds: {
      cache: new Map([
        [
          guild,
          {
            channels: { fetch: async () => channel },
            members: { me: {} },
            iconURL: () => null,
          },
        ],
      ]),
    },
  } as unknown as Client;
  const actor = {
    id: "345678901234567890",
    displayName: "Dave",
    displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
  } as unknown as User;
  assert.equal(
    await new AuditLogger(client, new AllowedRoleStore("/unused")).record(
      guild,
      { title: "Command used", description: "Used /weekly-checkup.", actor },
      channelId,
    ),
    true,
  );
  assert.deepEqual(payload?.allowedMentions, { parse: [] });
  assert.equal(payload?.embeds[0]?.toJSON().author?.name, "Dave");
  assert.ok(
    payload?.embeds[0]
      ?.toJSON()
      .fields?.some((field) => field.value.includes(actor.id)),
  );
});

test("a deleted log channel never breaks the underlying bot action", async (context) => {
  context.mock.method(console, "warn", () => undefined);
  const client = {
    guilds: {
      cache: new Map([
        [
          guild,
          {
            channels: {
              fetch: async () => {
                throw new Error("Missing channel");
              },
            },
          },
        ],
      ]),
    },
  } as unknown as Client;
  assert.equal(
    await new AuditLogger(client, new AllowedRoleStore("/unused")).record(
      guild,
      { title: "Test", description: "Metadata" },
      channelId,
    ),
    false,
  );
});

test("diagnostic messages redact the bot token and signing secret", () => {
  assert.deepEqual(
    describeError(new Error("Request failed: token-123 and secret-456"), [
      "token-123",
      "secret-456",
    ]),
    { name: "Error", message: "Request failed: [redacted] and [redacted]" },
  );
});
