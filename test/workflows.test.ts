import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ChannelType,
  PermissionsBitField,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type MessageCreateOptions,
} from "discord.js";
import { AllowedRoleStore } from "../src/allowedRoleStore.js";
import { handleAccessCommand } from "../src/allowedRoles.js";
import { type AuditLogger } from "../src/auditLog.js";
import { handleBotSettings } from "../src/botSettings.js";
import { CheckupStore, type CheckupRecord } from "../src/checkupStore.js";
import { loadConfig } from "../src/config.js";
import {
  createCheckupCustomId,
  createStoredCheckupCustomId,
  parseStoredCheckupCustomId,
} from "../src/customIds.js";
import {
  handleWeeklyCheckupButton,
  handleWeeklyCheckupCommand,
  handleWeeklyCheckupModal,
} from "../src/weeklyCheckup.js";

const record: CheckupRecord = {
  id: "test-checkup-1234",
  guildId: "123456789012345678",
  channelId: "234567890123456789",
  messageId: "345678901234567890",
  partnerRoleId: "456789012345678901",
  responseChannelId: "567890123456789012",
  period: "Week 42",
  createdAt: Date.now(),
  closedAt: null,
  responses: {},
};
const config = loadConfig({
  DISCORD_TOKEN: "test",
  DISCORD_CLIENT_ID: "999999999999999999",
  DISCORD_GUILD_IDS: record.guildId,
  CUSTOM_ID_SECRET: "only-for-tests-abcdefghijklmnopqrstuvwxyz",
});
const userId = "678901234567890123";
const actor = {
  id: userId,
  displayName: "Example",
  displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
};

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "glixera-flow-"));
  const access = new AllowedRoleStore(directory);
  await access.initialize([record.guildId]);
  const checkups = new CheckupStore(directory);
  await checkups.initialize();
  await checkups.create(record);
  const logs: unknown[] = [];
  const audit = {
    record: async (_guildId: string, event: unknown) => {
      logs.push(event);
      return true;
    },
  } as unknown as AuditLogger;
  const replies: { embeds?: { toJSON(): { title?: string } }[] }[] = [];
  const guild = { id: record.guildId, ownerId: config.clientId };
  const interaction = {
    id: "789012345678901234",
    guildId: record.guildId,
    channelId: record.channelId,
    user: actor,
    guild,
    member: {
      id: userId,
      guild,
      permissions: new PermissionsBitField(0n),
      roles: { cache: new Map([[record.partnerRoleId, {}]]) },
    },
    inCachedGuild: () => true,
    deferReply: async () => undefined,
    reply: async (payload: (typeof replies)[number]) => {
      replies.push(payload);
    },
    editReply: async (payload: (typeof replies)[number]) => {
      replies.push(payload);
    },
  };
  return {
    directory,
    access,
    checkups,
    audit,
    logs,
    replies,
    interaction,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function postingInteraction(
  fixture: Awaited<ReturnType<typeof setup>>,
  send: (payload: MessageCreateOptions) => Promise<unknown>,
) {
  const channel = {
    id: record.channelId,
    type: ChannelType.GuildText,
    permissionsFor: () => ({ has: () => true }),
    send,
  };
  const role = {
    id: record.partnerRoleId,
    managed: false,
    mentionable: true,
    permissions: new PermissionsBitField(0n),
    toString: () => `<@&${record.partnerRoleId}>`,
  };
  return {
    ...fixture.interaction,
    guild: {
      ...fixture.interaction.guild,
      members: { me: {} },
      iconURL: () => null,
    },
    options: {
      getRole: () => role,
      getChannel: (name: string) =>
        name === "questionnaire-channel" ? channel : null,
      getString: () => "Week 42",
    },
  } as unknown as ChatInputCommandInteraction<"cached">;
}

test("new questionnaires include working buttons in their initial message without a follow-up edit", async () => {
  const fixture = await setup();
  try {
    let controlId = "";
    let sends = 0;
    const interaction = postingInteraction(fixture, async (payload) => {
      sends += 1;
      const body = JSON.parse(JSON.stringify(payload)) as {
        components?: {
          components: { custom_id: string; label: string; disabled: boolean }[];
        }[];
      };
      assert.equal(
        body.components?.length,
        1,
        "The initial message must already contain its button row",
      );
      const buttons = body.components![0]!.components;
      assert.deepEqual(
        buttons.map((button) => button.label),
        ["Answer checkup", "Close checkup"],
      );
      assert.ok(buttons.every((button) => !button.disabled));
      controlId = buttons[0]!.custom_id;
      assert.deepEqual(payload.allowedMentions, {
        parse: [],
        roles: [record.partnerRoleId],
      });
      return {
        id: "890123456789012345",
        url: "https://discord.com/channels/123456789012345678/234567890123456789/890123456789012345",
        edit: async () => {
          assert.fail(
            "Questionnaire creation must not depend on editing the posted message",
          );
        },
        delete: async () => undefined,
      };
    });
    await handleWeeklyCheckupCommand(
      interaction,
      config,
      fixture.access,
      fixture.checkups,
      fixture.audit,
    );
    const control = parseStoredCheckupCustomId(
      controlId,
      config.customIdSecret,
    );
    assert.equal(control?.action, "answer");
    assert.equal(
      fixture.checkups.get(control!.checkupId)?.messageId,
      "890123456789012345",
    );
    assert.equal(sends, 1);
    assert.equal(
      fixture.replies[0]?.embeds?.[0]?.toJSON().title,
      "Weekly checkup sent",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("a questionnaire is removed if its persistent state cannot be saved", async (context) => {
  const fixture = await setup();
  try {
    let removed = false;
    context.mock.method(fixture.checkups, "create", async () => {
      throw new Error("Storage unavailable");
    });
    const interaction = postingInteraction(fixture, async () => ({
      id: "890123456789012345",
      delete: async () => {
        removed = true;
      },
    }));
    await assert.rejects(
      handleWeeklyCheckupCommand(
        interaction,
        config,
        fixture.access,
        fixture.checkups,
        fixture.audit,
      ),
      /Storage unavailable/,
    );
    assert.equal(removed, true);
    assert.equal(fixture.replies.length, 0);
    assert.equal(fixture.logs.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("a 0.2.x weekly button opens the new rated form and upgrades its controls", async () => {
  const fixture = await setup();
  try {
    let modalId = "";
    let upgraded = false;
    const interaction = {
      ...fixture.interaction,
      customId: createCheckupCustomId("answer", record, config.customIdSecret),
      client: { user: { id: config.clientId } },
      message: {
        id: "890123456789012345",
        author: { id: config.clientId },
        createdTimestamp: Date.now(),
        edit: async () => {
          upgraded = true;
        },
      },
      showModal: async (modal: { toJSON(): { custom_id: string } }) => {
        modalId = modal.toJSON().custom_id;
      },
    } as unknown as ButtonInteraction;
    await handleWeeklyCheckupButton(
      interaction,
      config,
      fixture.access,
      fixture.checkups,
      fixture.audit,
    );
    assert.equal(
      parseStoredCheckupCustomId(modalId, config.customIdSecret)?.action,
      "submit",
    );
    assert.ok(fixture.checkups.get("890123456789012345"));
    assert.equal(upgraded, true);
  } finally {
    await fixture.cleanup();
  }
});

test("a signed checkup button copied onto a different message cannot be used", async () => {
  const fixture = await setup();
  try {
    let opened = false;
    const interaction = {
      ...fixture.interaction,
      customId: createStoredCheckupCustomId(
        "answer",
        record.guildId,
        record.id,
        config.customIdSecret,
      ),
      client: { user: { id: config.clientId } },
      message: { id: "890123456789012345", author: { id: config.clientId } },
      showModal: async () => {
        opened = true;
      },
    } as unknown as ButtonInteraction;
    await handleWeeklyCheckupButton(
      interaction,
      config,
      fixture.access,
      fixture.checkups,
      fixture.audit,
    );
    assert.equal(opened, false);
    assert.equal(
      fixture.replies[0]?.embeds?.[0]?.toJSON().title,
      "Invalid checkup",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("an already-open form is refused after closure without looking up a delivery channel", async () => {
  const fixture = await setup();
  try {
    await fixture.checkups.close(record.id);
    const interaction = {
      ...fixture.interaction,
      customId: createStoredCheckupCustomId(
        "submit",
        record.guildId,
        record.id,
        config.customIdSecret,
      ),
    } as unknown as ModalSubmitInteraction;
    await handleWeeklyCheckupModal(
      interaction,
      config,
      fixture.access,
      fixture.checkups,
      fixture.audit,
    );
    assert.equal(
      fixture.replies[0]?.embeds?.[0]?.toJSON().title,
      "Checkup closed",
    );
  } finally {
    await fixture.cleanup();
  }
});

test("a valid rated response is delivered with a retry nonce, logged and persisted", async () => {
  const fixture = await setup();
  try {
    let sent = 0;
    const channel = {
      id: record.responseChannelId,
      type: ChannelType.GuildText,
      permissionsFor: () => ({ has: () => true }),
      send: async (payload: {
        nonce: string;
        enforceNonce: boolean;
        embeds: { toJSON(): { fields?: { name: string; value: string }[] } }[];
      }) => {
        assert.match(payload.nonce, /^[a-f0-9]{24}$/);
        assert.equal(payload.enforceNonce, true);
        assert.equal(
          payload.embeds[0]
            ?.toJSON()
            .fields?.find((field) => field.name === "Partnership rating")
            ?.value,
          "★★★★★ · 5/5",
        );
        sent++;
        return { id: "890123456789012345" };
      },
    };
    const interaction = {
      ...fixture.interaction,
      customId: createStoredCheckupCustomId(
        "submit",
        record.guildId,
        record.id,
        config.customIdSecret,
      ),
      guild: {
        ...fixture.interaction.guild,
        roles: { fetch: async () => ({ id: record.partnerRoleId }) },
        channels: { fetch: async () => channel },
        members: { me: {} },
      },
      fields: {
        getTextInputValue: () => "Useful feedback",
        getStringSelectValues: () => ["5"],
      },
    } as unknown as ModalSubmitInteraction;
    await handleWeeklyCheckupModal(
      interaction,
      config,
      fixture.access,
      fixture.checkups,
      fixture.audit,
    );
    assert.equal(sent, 1);
    assert.equal(
      fixture.checkups.get(record.id)?.responses[userId]?.messageId,
      "890123456789012345",
    );
    assert.equal(
      fixture.replies[0]?.embeds?.[0]?.toJSON().title,
      "Checkup submitted",
    );
    assert.equal(fixture.logs.length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("slash commands grant, change and revoke individual access", async () => {
  const fixture = await setup();
  try {
    let action = "add";
    let level = "manager";
    const interaction = {
      ...fixture.interaction,
      commandName: "allowed-user",
      guild: {
        ...fixture.interaction.guild,
        members: { fetch: async () => ({ id: userId }) },
      },
      options: {
        getSubcommand: () => action,
        getUser: () => ({ ...actor, bot: false }),
        getString: () => level,
      },
    } as unknown as ChatInputCommandInteraction<"cached">;
    await handleAccessCommand(interaction, fixture.access, fixture.audit);
    assert.equal(
      fixture.access.hasManager(record.guildId, userId, new Set()),
      true,
    );
    level = "operator";
    await handleAccessCommand(interaction, fixture.access, fixture.audit);
    assert.equal(
      fixture.access.hasManager(record.guildId, userId, new Set()),
      false,
    );
    assert.equal(
      fixture.access.hasAccess(record.guildId, userId, new Set()),
      true,
    );
    action = "remove";
    await handleAccessCommand(interaction, fixture.access, fixture.audit);
    assert.equal(
      fixture.access.hasAccess(record.guildId, userId, new Set()),
      false,
    );
  } finally {
    await fixture.cleanup();
  }
});

test("slash commands set, test and disable the persistent log channel", async () => {
  const fixture = await setup();
  try {
    let action = "log-channel";
    const channel = {
      id: record.responseChannelId,
      type: ChannelType.GuildText,
      permissionsFor: () => ({ has: () => true }),
    };
    const interaction = {
      ...fixture.interaction,
      guild: { ...fixture.interaction.guild, members: { me: {} } },
      options: { getSubcommand: () => action, getChannel: () => channel },
    } as unknown as ChatInputCommandInteraction<"cached">;
    await handleBotSettings(interaction, fixture.access, fixture.audit);
    assert.equal(
      fixture.access.getSnapshot(record.guildId).logChannelId,
      channel.id,
    );
    action = "test-log";
    await handleBotSettings(interaction, fixture.access, fixture.audit);
    action = "disable-logs";
    await handleBotSettings(interaction, fixture.access, fixture.audit);
    assert.equal(fixture.access.getSnapshot(record.guildId).logChannelId, null);
    assert.equal(fixture.logs.length, 3);
  } finally {
    await fixture.cleanup();
  }
});
