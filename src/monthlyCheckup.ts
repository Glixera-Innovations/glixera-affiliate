import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
  type TextChannel,
} from "discord.js";

import type { AllowedRoleStore } from "./allowedRoleStore.js";
import type { AppConfig } from "./config.js";
import {
  createCheckupCustomId,
  parseCheckupCustomId,
  type CheckupContext,
} from "./customIds.js";
import {
  errorEmbed,
  infoEmbed,
  successEmbed,
  warningEmbed,
} from "./embeds.js";

const QUESTIONNAIRE_COLOR = 0x5865f2;
const RESPONSE_COLOR = 0x57f287;
const CLOSED_COLOR = 0x747f8d;
const REQUIRED_CHANNEL_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
] as const;

function isConfiguredGuild(config: AppConfig, guildId: string): boolean {
  return config.guildIds.includes(guildId);
}

function hasAllowedRole(
  member: GuildMember,
  guildId: string,
  allowedRoleStore: AllowedRoleStore,
): boolean {
  return allowedRoleStore.hasAllowedRole(guildId, member.roles.cache);
}

function canUseCheckup(
  member: GuildMember,
  guildId: string,
  partnerRoleId: string,
  allowedRoleStore: AllowedRoleStore,
): boolean {
  return (
    member.roles.cache.has(partnerRoleId) ||
    hasAllowedRole(member, guildId, allowedRoleStore)
  );
}

function botCanSend(channel: TextChannel, botMember: GuildMember): boolean {
  return channel.permissionsFor(botMember)?.has(REQUIRED_CHANNEL_PERMISSIONS) ?? false;
}

function defaultPeriod(timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date());
}

function normalizePeriod(value: string | null, timeZone: string): string | null {
  const period = (value ?? defaultPeriod(timeZone)).replace(/\s+/g, " ").trim();
  return period.length > 0 && period.length <= 40 ? period : null;
}

function asMultilineCodeBlock(value: string): string {
  const content = (value || "None provided").replaceAll("```", "`\u200b`");
  return `\`\`\`\n${content}\n\`\`\``;
}

export function buildQuestionnaireEmbed(
  period: string,
  requestedBy: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(QUESTIONNAIRE_COLOR)
    .setTitle(`Monthly Partnership Checkup • ${period}`)
    .setDescription(
      "Hello! It is time for our monthly Glixera Innovations partnership checkup. " +
        "Please have one representative submit a response using the button below.",
    )
    .addFields(
      {
        name: "Announcements",
        value:
          "Does your community have any announcements you would like Glixera to share in our channels?",
      },
      {
        name: "Events",
        value:
          "Do you have any events planned that we should know about, promote, or participate in?",
      },
      {
        name: "Partnership experience",
        value:
          "How are you finding the partnership so far, and is there anything we could improve?",
      },
    )
    .setFooter({
      text: `Requested by ${requestedBy} • Management can close this checkup when complete.`,
    });
}

function buildCheckupButtons(
  context: CheckupContext,
  config: AppConfig,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(createCheckupCustomId("answer", context, config.customIdSecret))
      .setLabel("Answer checkup")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(createCheckupCustomId("close", context, config.customIdSecret))
      .setLabel("Close checkup")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function buildAnswerModal(context: CheckupContext, config: AppConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(createCheckupCustomId("submit", context, config.customIdSecret))
    .setTitle(`Monthly checkup • ${context.period}`.slice(0, 45));

  const announcements = new TextInputBuilder()
    .setCustomId("announcements")
    .setLabel("Announcements to share")
    .setPlaceholder("Include the announcement and preferred posting date, or write “None”.")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(1)
    .setMaxLength(1000)
    .setRequired(true);

  const events = new TextInputBuilder()
    .setCustomId("events")
    .setLabel("Upcoming events")
    .setPlaceholder("Include dates, times, time zone, and how Glixera can help, or write “None”.")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(1)
    .setMaxLength(1000)
    .setRequired(true);

  const feedback = new TextInputBuilder()
    .setCustomId("feedback")
    .setLabel("Partnership feedback")
    .setPlaceholder("Tell us what is working well and what we could improve.")
    .setStyle(TextInputStyle.Paragraph)
    .setMinLength(1)
    .setMaxLength(1000)
    .setRequired(true);

  return modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(announcements),
    new ActionRowBuilder<TextInputBuilder>().addComponents(events),
    new ActionRowBuilder<TextInputBuilder>().addComponents(feedback),
  );
}

export async function handleMonthlyCheckupCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  allowedRoleStore: AllowedRoleStore,
): Promise<void> {
  if (!interaction.inCachedGuild() || !isConfiguredGuild(config, interaction.guildId)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Unavailable server",
          "This command is only available in a configured Glixera server.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!hasAllowedRole(interaction.member, interaction.guildId, allowedRoleStore)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Access denied",
          "You do not have an authorized management role for this command.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const partnerRole = interaction.options.getRole("partner-role", true);
  const questionnaireChannel = interaction.options.getChannel("questionnaire-channel", true);
  const selectedResponseChannel = interaction.options.getChannel("response-channel");
  const responseChannel = selectedResponseChannel ?? questionnaireChannel;
  const period = normalizePeriod(interaction.options.getString("period"), config.timeZone);
  const allowedRoleIds = allowedRoleStore.getSnapshot(interaction.guildId).allRoleIds;

  if (questionnaireChannel.type !== ChannelType.GuildText) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Invalid questionnaire channel",
          "The questionnaire destination must be a server text channel.",
        ),
      ],
    });
    return;
  }

  if (responseChannel.type !== ChannelType.GuildText) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Invalid response channel",
          "The response destination must be a server text channel.",
        ),
      ],
    });
    return;
  }

  if (!period) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Invalid period",
          "The checkup period must contain between 1 and 40 characters.",
        ),
      ],
    });
    return;
  }

  if (
    partnerRole.id === interaction.guild.id ||
    partnerRole.managed ||
    allowedRoleIds.includes(partnerRole.id)
  ) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Invalid partnership role",
          "Select a normal partnership role. `@everyone`, managed integration roles, and management roles cannot be targeted.",
        ),
      ],
    });
    return;
  }

  const botMember = interaction.guild.members.me;

  if (!botMember) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Permission check failed",
          "I could not verify my server permissions. Please try again shortly.",
        ),
      ],
    });
    return;
  }

  if (!botCanSend(questionnaireChannel, botMember)) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Missing bot permissions",
          `I need **View Channel**, **Send Messages**, and **Embed Links** in ${questionnaireChannel}.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (!botCanSend(responseChannel, botMember)) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Missing bot permissions",
          `I need **View Channel**, **Send Messages**, and **Embed Links** in ${responseChannel}.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const canMentionRole =
    partnerRole.mentionable ||
    (questionnaireChannel.permissionsFor(botMember)?.has(PermissionFlagsBits.MentionEveryone) ??
      false);

  if (!canMentionRole) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Role cannot be mentioned",
          `${partnerRole} is not mentionable. Either make that partnership role mentionable or give the bot the **Mention @everyone, @here, and All Roles** permission in ${questionnaireChannel}.`,
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  const context: CheckupContext = {
    partnerRoleId: partnerRole.id,
    responseChannelId: responseChannel.id,
    period,
  };
  const questionnaire = await questionnaireChannel.send({
    content: partnerRole.toString(),
    embeds: [buildQuestionnaireEmbed(period, interaction.user.username)],
    components: [buildCheckupButtons(context, config)],
    allowedMentions: {
      parse: [],
      roles: [partnerRole.id],
    },
  });

  await interaction.editReply({
    embeds: [
      successEmbed(
        "Monthly checkup sent",
        `Sent to ${questionnaireChannel} for ${partnerRole}. Completed answers will go to ${responseChannel}. [Open questionnaire](${questionnaire.url})`,
      ),
    ],
    allowedMentions: { parse: [] },
  });
}

export async function handleMonthlyCheckupButton(
  interaction: ButtonInteraction,
  config: AppConfig,
  allowedRoleStore: AllowedRoleStore,
): Promise<void> {
  if (!interaction.inCachedGuild() || !isConfiguredGuild(config, interaction.guildId)) {
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

  const parsed = parseCheckupCustomId(interaction.customId, config.customIdSecret);

  if (!parsed || (parsed.action !== "answer" && parsed.action !== "close")) {
    await interaction.reply({
      embeds: [
        warningEmbed(
          "Invalid checkup",
          "This checkup control is invalid or was signed with an older secret. Ask management to send a new checkup.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (parsed.action === "answer") {
    if (
      !canUseCheckup(
        interaction.member,
        interaction.guildId,
        parsed.partnerRoleId,
        allowedRoleStore,
      )
    ) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            "Access denied",
            "Only members of the selected partnership role or management can answer this checkup.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(buildAnswerModal(parsed, config));
    return;
  }

  if (!hasAllowedRole(interaction.member, interaction.guildId, allowedRoleStore)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Access denied",
          "Only an authorized management role can close this checkup.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const existingEmbed = interaction.message.embeds[0];
  const closedEmbed = existingEmbed
    ? EmbedBuilder.from(existingEmbed)
    : new EmbedBuilder().setTitle(`Monthly Partnership Checkup • ${parsed.period}`);

  closedEmbed
    .setColor(CLOSED_COLOR)
    .setFooter({ text: `Closed by ${interaction.user.username}` });

  await interaction.update({
    embeds: [closedEmbed],
    components: [buildCheckupButtons(parsed, config, true)],
  });
  await interaction.followUp({
    embeds: [
      infoEmbed("Monthly checkup closed", "The monthly checkup is now closed."),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleMonthlyCheckupModal(
  interaction: ModalSubmitInteraction,
  config: AppConfig,
  allowedRoleStore: AllowedRoleStore,
): Promise<void> {
  if (!interaction.inCachedGuild() || !isConfiguredGuild(config, interaction.guildId)) {
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

  const parsed = parseCheckupCustomId(interaction.customId, config.customIdSecret);

  if (!parsed || parsed.action !== "submit") {
    await interaction.reply({
      embeds: [
        warningEmbed(
          "Invalid questionnaire",
          "This questionnaire is invalid or was signed with an older secret. Ask management to send a new checkup.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (
    !canUseCheckup(
      interaction.member,
      interaction.guildId,
      parsed.partnerRoleId,
      allowedRoleStore,
    )
  ) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Access denied",
          "You no longer have the partnership role required to submit this checkup.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [partnerRole, responseChannel] = await Promise.all([
    interaction.guild.roles.fetch(parsed.partnerRoleId),
    interaction.guild.channels.fetch(parsed.responseChannelId),
  ]);

  if (!partnerRole) {
    await interaction.editReply({
      embeds: [
        warningEmbed(
          "Partnership role missing",
          "The partnership role no longer exists. Ask management to send a new checkup.",
        ),
      ],
    });
    return;
  }

  if (!responseChannel || responseChannel.type !== ChannelType.GuildText) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Response channel missing",
          "The configured response channel no longer exists. Please contact management.",
        ),
      ],
    });
    return;
  }

  const botMember = interaction.guild.members.me;

  if (!botMember || !botCanSend(responseChannel, botMember)) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Cannot post response",
          "I can no longer post in the configured response channel. Please contact management.",
        ),
      ],
    });
    return;
  }

  const announcements = interaction.fields.getTextInputValue("announcements").trim();
  const events = interaction.fields.getTextInputValue("events").trim();
  const feedback = interaction.fields.getTextInputValue("feedback").trim();

  const responseEmbed = new EmbedBuilder()
    .setColor(RESPONSE_COLOR)
    .setTitle(`Monthly Checkup Response • ${parsed.period}`)
    .setDescription(`Partnership: ${partnerRole}`)
    .setAuthor({
      name: interaction.user.username,
      iconURL: interaction.user.displayAvatarURL({ size: 128 }),
    })
    .addFields(
      { name: "Announcements", value: asMultilineCodeBlock(announcements) },
      { name: "Events", value: events || "None provided" },
      { name: "Partnership feedback", value: feedback || "None provided" },
      { name: "Submitted by", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Partnership role", value: partnerRole.toString(), inline: true },
    )
    .setFooter({
      text: `Response ID: ${interaction.id}`,
    })
    .setTimestamp();

  await responseChannel.send({
    embeds: [responseEmbed],
    allowedMentions: { parse: [] },
  });

  await interaction.editReply({
    embeds: [
      successEmbed(
        "Checkup submitted",
        "Thank you! Your monthly partnership checkup was submitted successfully.",
      ),
    ],
  });
}
