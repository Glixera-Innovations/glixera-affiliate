import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { AllowedRoleStore } from "./allowedRoleStore.js";
import type { AuditLogger } from "./auditLog.js";
import { errorEmbed, infoEmbed, successEmbed, withActor } from "./embeds.js";

export async function handleBotSettings(
  interaction: ChatInputCommandInteraction<"cached">,
  store: AllowedRoleStore,
  audit: AuditLogger,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const action = interaction.options.getSubcommand();
  const previousChannel = store.getSnapshot(interaction.guildId).logChannelId;
  if (action === "show") {
    await interaction.editReply({
      embeds: [
        withActor(
          infoEmbed(
            "Bot settings",
            "Settings are stored separately for each server.",
          ),
          interaction.user,
        ).addFields(
          {
            name: "Usage logging",
            value: previousChannel ? `<#${previousChannel}>` : "Disabled",
            inline: true,
          },
          {
            name: "Access",
            value:
              "Use `/allowed-role` and `/allowed-user` to view or change access.",
          },
          {
            name: "Logged events",
            value:
              "Command use, access changes, denied actions, checkups sent/closed and response metadata. Written feedback is not copied into logs.",
          },
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (action === "disable-logs") {
    await store.setLogChannel(interaction.guildId, null);
    if (previousChannel)
      await audit.record(
        interaction.guildId,
        {
          title: "Usage logging disabled",
          description:
            "Further usage logs will not be posted until logging is enabled again.",
          actor: interaction.user,
        },
        previousChannel,
      );
    await interaction.editReply({
      embeds: [
        successEmbed(
          "Usage logging disabled",
          "New usage events will no longer be posted. Existing log messages are unchanged.",
        ),
      ],
    });
    return;
  }
  if (action === "test-log") {
    const delivered = await audit.record(interaction.guildId, {
      title: "Usage logging test",
      description: "Logging is configured and the bot can post here.",
      actor: interaction.user,
    });
    await interaction.editReply({
      embeds: [
        delivered
          ? successEmbed(
              "Test log sent",
              "The configured channel received a test entry.",
            )
          : errorEmbed(
              "Test log failed",
              "Set a log channel and check that the bot can view it, send messages and embed links.",
            ),
      ],
    });
    return;
  }
  const channel = interaction.options.getChannel("channel", true);
  const bot = interaction.guild.members.me;
  if (
    channel.type !== ChannelType.GuildText ||
    !bot ||
    !channel
      .permissionsFor(bot)
      ?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ]) ||
    !channel
      .permissionsFor(interaction.member)
      ?.has(PermissionFlagsBits.ViewChannel)
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Channel unavailable",
          "Choose a text channel you can view, where the bot has View Channel, Send Messages and Embed Links.",
        ),
      ],
    });
    return;
  }
  await store.setLogChannel(interaction.guildId, channel.id);
  const delivered = await audit.record(interaction.guildId, {
    title: "Usage logging enabled",
    description:
      "Bot usage and management actions will be logged in this channel. Feedback text is excluded.",
    actor: interaction.user,
  });
  await interaction.editReply({
    embeds: [
      delivered
        ? successEmbed(
            "Log channel updated",
            `Usage events will be posted in ${channel}.`,
          )
        : errorEmbed(
            "Log channel saved",
            "The channel was saved, but the first log could not be delivered. Check its permissions and run `/bot-settings test-log`.",
          ),
    ],
    allowedMentions: { parse: [] },
  });
}
