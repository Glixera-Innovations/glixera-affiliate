import { ChannelType, SlashCommandBuilder } from "discord.js";

export const monthlyCheckupCommand = new SlashCommandBuilder()
  .setName("monthly-checkup")
  .setDescription("Send Glixera's monthly questionnaire to a partnership role.")
  .addRoleOption((option) =>
    option
      .setName("partner-role")
      .setDescription("The partnership role that should receive the questionnaire.")
      .setRequired(true),
  )
  .addChannelOption((option) =>
    option
      .setName("questionnaire-channel")
      .setDescription("The channel where the questionnaire and role ping should be posted.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addChannelOption((option) =>
    option
      .setName("response-channel")
      .setDescription("Where completed answers go; defaults to the questionnaire channel.")
      .addChannelTypes(ChannelType.GuildText),
  )
  .addStringOption((option) =>
    option
      .setName("period")
      .setDescription("Optional label, for example: August 2026.")
      .setMaxLength(40),
  );

export const applicationCommands = [monthlyCheckupCommand.toJSON()];
