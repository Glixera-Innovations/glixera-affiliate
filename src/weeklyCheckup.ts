import { randomBytes } from "node:crypto";
import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";
import type { AllowedRoleStore } from "./allowedRoleStore.js";
import type { AppConfig } from "./config.js";
import type { AuditLogger } from "./auditLog.js";
import { canOperateBot } from "./access.js";
import { CheckupStore, type CheckupRecord } from "./checkupStore.js";
import {
  parseCheckupCustomId,
  parseStoredCheckupCustomId,
} from "./customIds.js";
import {
  errorEmbed,
  infoEmbed,
  successEmbed,
  warningEmbed,
  withActor,
} from "./embeds.js";
import { defaultPeriod } from "./period.js";
import {
  buildAnswerModal,
  buildCheckupButtons,
  buildQuestionnaireEmbed,
  buildResponseEmbed,
  formatRating,
  readCheckupAnswers,
} from "./questionnaire.js";

export { defaultPeriod } from "./period.js";
export { buildQuestionnaireEmbed } from "./questionnaire.js";

const SEND_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];
const canAnswer = (
  member: GuildMember,
  record: CheckupRecord,
  access: AllowedRoleStore,
): boolean =>
  member.roles.cache.has(record.partnerRoleId) || canOperateBot(member, access);
const botCanSend = (channel: TextChannel, member: GuildMember): boolean =>
  channel.permissionsFor(member)?.has(SEND_PERMISSIONS) ?? false;

export async function handleWeeklyCheckupCommand(
  interaction: ChatInputCommandInteraction<"cached">,
  config: AppConfig,
  access: AllowedRoleStore,
  checkups: CheckupStore,
  audit: AuditLogger,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const partnerRole = interaction.options.getRole("partner-role", true);
  const channel = interaction.options.getChannel("questionnaire-channel", true);
  const responseChannel =
    interaction.options.getChannel("response-channel") ?? channel;
  const period = (
    interaction.options.getString("period") ?? defaultPeriod(config.timeZone)
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!period || period.length > 40) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Invalid period",
          "Use between 1 and 40 characters for the checkup period.",
        ),
      ],
    });
    return;
  }
  if (
    channel.type !== ChannelType.GuildText ||
    responseChannel.type !== ChannelType.GuildText
  ) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Invalid channel",
          "Questionnaires and responses need server text channels.",
        ),
      ],
    });
    return;
  }
  if (
    partnerRole.id === interaction.guildId ||
    partnerRole.managed ||
    partnerRole.permissions.has(PermissionFlagsBits.Administrator) ||
    access.getSnapshot(interaction.guildId).allRoleIds.includes(partnerRole.id)
  ) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Invalid partnership role",
          "Select a regular partnership role. Everyone, integration, administrator and bot-management roles cannot be targeted.",
        ),
      ],
    });
    return;
  }
  const bot = interaction.guild.members.me;
  if (!bot || !botCanSend(channel, bot) || !botCanSend(responseChannel, bot)) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Missing bot permissions",
          "The bot needs View Channel, Send Messages and Embed Links in both selected channels.",
        ),
      ],
    });
    return;
  }
  if (
    ![channel, responseChannel].every((destination) =>
      destination
        .permissionsFor(interaction.member)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
        ]),
    )
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Channel access required",
          "You must be able to view and send messages in both selected channels.",
        ),
      ],
    });
    return;
  }
  if (
    !partnerRole.mentionable &&
    !channel.permissionsFor(bot)?.has(PermissionFlagsBits.MentionEveryone)
  ) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Role cannot be mentioned",
          "Make the partnership role mentionable, or allow the bot to mention roles in the questionnaire channel.",
        ),
      ],
    });
    return;
  }
  const embed = withActor(
    buildQuestionnaireEmbed(period, interaction.user.displayName),
    interaction.user,
  );
  const icon = interaction.guild.iconURL({ size: 256 });
  if (icon) embed.setThumbnail(icon);
  const controls = {
    id: randomBytes(12).toString("base64url"),
    guildId: interaction.guildId,
  };
  const message = await channel.send({
    content: partnerRole.toString(),
    embeds: [embed],
    components: [buildCheckupButtons(controls, config)],
    allowedMentions: { parse: [], roles: [partnerRole.id] },
  });
  const record: CheckupRecord = {
    ...controls,
    channelId: channel.id,
    messageId: message.id,
    partnerRoleId: partnerRole.id,
    responseChannelId: responseChannel.id,
    period,
    createdAt: Date.now(),
    closedAt: null,
    responses: {},
  };
  try {
    await checkups.create(record);
  } catch (error) {
    await checkups.close(record.id).catch(() => undefined);
    await message.delete().catch(() => undefined);
    throw error;
  }
  await interaction.editReply({
    embeds: [
      successEmbed(
        "Weekly checkup sent",
        `Sent to ${channel} for ${partnerRole}. Answers and the star rating will go to ${responseChannel}. [Open questionnaire](${message.url})`,
      ),
    ],
    allowedMentions: { parse: [] },
  });
  await audit.record(interaction.guildId, {
    title: "Checkup sent",
    description: `[Open questionnaire](${message.url}) · Partnership ${partnerRole}.`,
    actor: interaction.user,
    fields: [
      { name: "Period", value: period, inline: false },
      { name: "Response channel", value: `${responseChannel}`, inline: false },
    ],
  });
}

async function resolveButton(
  interaction: ButtonInteraction<"cached">,
  config: AppConfig,
  checkups: CheckupStore,
): Promise<{ record: CheckupRecord; action: "answer" | "close" } | null> {
  if (interaction.message.author.id !== interaction.client.user.id) return null;
  const control = parseStoredCheckupCustomId(
    interaction.customId,
    config.customIdSecret,
  );
  if (control) {
    if (control.guildId !== interaction.guildId || control.action === "submit")
      return null;
    const record = checkups.get(control.checkupId);
    return record &&
      record.guildId === interaction.guildId &&
      record.channelId === interaction.channelId &&
      record.messageId === interaction.message.id
      ? { record, action: control.action }
      : null;
  }
  // Existing 0.2.x questionnaires can be opened and upgraded without reposting.
  const legacy = parseCheckupCustomId(
    interaction.customId,
    config.customIdSecret,
  );
  if (!legacy || legacy.action === "submit") return null;
  const record = await checkups.create({
    id: interaction.message.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    messageId: interaction.message.id,
    partnerRoleId: legacy.partnerRoleId,
    responseChannelId: legacy.responseChannelId,
    period: legacy.period,
    createdAt: interaction.message.createdTimestamp,
    closedAt: null,
    responses: {},
  });
  if (
    record.guildId !== interaction.guildId ||
    record.messageId !== interaction.message.id
  )
    return null;
  return { record, action: legacy.action };
}

export async function handleWeeklyCheckupButton(
  interaction: ButtonInteraction,
  config: AppConfig,
  access: AllowedRoleStore,
  checkups: CheckupStore,
  audit: AuditLogger,
): Promise<void> {
  if (
    !interaction.inCachedGuild() ||
    !config.guildIds.includes(interaction.guildId)
  ) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Unavailable checkup",
          "This checkup is not available in this server.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const resolved = await resolveButton(interaction, config, checkups);
  if (!resolved) {
    await interaction.reply({
      embeds: [
        warningEmbed(
          "Invalid checkup",
          "This control is invalid or its saved checkup is unavailable. Ask management to send a new questionnaire.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { record, action } = resolved;
  const permitted =
    action === "answer"
      ? canAnswer(interaction.member, record, access)
      : canOperateBot(interaction.member, access);
  if (!permitted) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Access denied",
          action === "answer"
            ? "Only the selected partnership role or bot operators can answer this checkup."
            : "Only bot operators can close a checkup.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    await audit.record(interaction.guildId, {
      title: "Checkup access denied",
      description: `A user tried to ${action} a checkup without the required access.`,
      actor: interaction.user,
    });
    return;
  }
  if (record.closedAt !== null && action === "answer") {
    await interaction.reply({
      embeds: [
        infoEmbed(
          "Checkup closed",
          "This questionnaire no longer accepts responses.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (action === "answer") {
    if (record.responses[interaction.user.id]?.messageId) {
      await interaction.reply({
        embeds: [
          infoEmbed(
            "Already submitted",
            "Your response to this checkup has already been received.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.showModal(buildAnswerModal(record, config));
    if (interaction.customId.startsWith("wcq:1:")) {
      // Replace legacy controls after acknowledging the modal, without delaying it.
      await interaction.message
        .edit({ components: [buildCheckupButtons(record, config)] })
        .catch(() => undefined);
    }
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await checkups.close(record.id);
  const existing = interaction.message.embeds[0];
  const embed = (
    existing
      ? EmbedBuilder.from(existing)
      : buildQuestionnaireEmbed(record.period, interaction.user.displayName)
  )
    .setColor(0x747f8d)
    .setFooter({ text: `Closed by ${interaction.user.displayName}` });
  try {
    await interaction.message.edit({
      embeds: [embed],
      components: [buildCheckupButtons(record, config, true)],
    });
    await interaction.editReply({
      embeds: [
        successEmbed(
          "Checkup closed",
          "This questionnaire no longer accepts responses, including forms that were already open.",
        ),
      ],
    });
  } catch {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Checkup closed",
          "Responses are blocked, but I could not update the message. Check my channel permissions.",
        ),
      ],
    });
  }
  await audit.record(interaction.guildId, {
    title: "Checkup closed",
    description: `[Open questionnaire](${interaction.message.url})`,
    actor: interaction.user,
  });
}

export async function handleWeeklyCheckupModal(
  interaction: ModalSubmitInteraction,
  config: AppConfig,
  access: AllowedRoleStore,
  checkups: CheckupStore,
  audit: AuditLogger,
): Promise<void> {
  if (
    !interaction.inCachedGuild() ||
    !config.guildIds.includes(interaction.guildId)
  ) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Unavailable checkup",
          "This checkup is not available in this server.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const control = parseStoredCheckupCustomId(
    interaction.customId,
    config.customIdSecret,
  );
  const record =
    control?.guildId === interaction.guildId && control.action === "submit"
      ? checkups.get(control.checkupId)
      : null;
  if (!record || record.guildId !== interaction.guildId) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Reopen the questionnaire",
          "This form is outdated or invalid. Open the checkup again to complete the current form, including its star rating.",
        ),
      ],
    });
    return;
  }
  if (!canAnswer(interaction.member, record, access)) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Access denied",
          "You no longer have the partnership role or bot access required for this checkup.",
        ),
      ],
    });
    await audit.record(interaction.guildId, {
      title: "Response access denied",
      description:
        "A checkup response was rejected because the user no longer had access.",
      actor: interaction.user,
    });
    return;
  }
  if (
    record.closedAt !== null ||
    record.responses[interaction.user.id]?.messageId
  ) {
    const duplicate = record.closedAt === null;
    await interaction.editReply({
      embeds: [
        infoEmbed(
          duplicate ? "Already submitted" : "Checkup closed",
          duplicate
            ? "Your response to this checkup has already been received."
            : "This questionnaire no longer accepts responses.",
        ),
      ],
    });
    return;
  }
  const answers = readCheckupAnswers(interaction.fields);
  if (!answers) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Complete all four answers",
          "Provide announcements, events and feedback (write “None” where appropriate), then select a rating from 1 to 5 stars. Reopen the form to try again.",
        ),
      ],
    });
    return;
  }
  const [role, channel] = await Promise.all([
    interaction.guild.roles.fetch(record.partnerRoleId),
    interaction.guild.channels.fetch(record.responseChannelId),
  ]);
  const bot = interaction.guild.members.me;
  if (
    !role ||
    !channel ||
    channel.type !== ChannelType.GuildText ||
    !bot ||
    !botCanSend(channel, bot)
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Cannot post response",
          "The partnership role or response channel is missing, or the bot no longer has permission to post there. Contact management.",
        ),
      ],
    });
    return;
  }
  const result = await checkups.submit(
    record.id,
    interaction.user.id,
    async (nonce) => {
      const message = await channel.send({
        embeds: [
          buildResponseEmbed(record, answers, interaction.user, interaction.id),
        ],
        allowedMentions: { parse: [] },
        nonce,
        enforceNonce: true,
      });
      return message.id;
    },
  );
  if (result.status !== "submitted") {
    await interaction.editReply({
      embeds: [
        infoEmbed(
          result.status === "duplicate"
            ? "Already submitted"
            : "Checkup closed",
          result.status === "duplicate"
            ? "Your response to this checkup has already been received."
            : "This questionnaire no longer accepts responses.",
        ),
      ],
    });
    return;
  }
  await interaction.editReply({
    embeds: [
      successEmbed(
        "Checkup submitted",
        `Thank you! Your feedback and **${formatRating(answers.rating)}** rating were received.`,
      ),
    ],
  });
  await audit.record(interaction.guildId, {
    title: "Checkup response received",
    description: `Partnership <@&${record.partnerRoleId}> · [Open response](https://discord.com/channels/${interaction.guildId}/${channel.id}/${result.messageId})`,
    actor: interaction.user,
    fields: [
      { name: "Rating", value: formatRating(answers.rating), inline: true },
      { name: "Period", value: record.period, inline: true },
    ],
  });
}
