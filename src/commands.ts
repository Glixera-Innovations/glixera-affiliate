import { ChannelType, SlashCommandBuilder } from "discord.js";

export const weeklyCheckupCommand = new SlashCommandBuilder()
  .setName("weekly-checkup")
  .setDescription("Send Glixera's weekly questionnaire to a partnership role.")
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
      .setDescription("For example: Week of 17–23 Aug 2026.")
      .setMaxLength(40),
  );

export const allowedRoleCommand = new SlashCommandBuilder()
  .setName("allowed-role")
  .setDescription("Manage which server roles can use Glixera management commands.")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Add an allowed role for this server.")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("The role to authorize.")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Remove a role from this server's allowed list.")
      .addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("The role to remove.")
          .setRequired(true),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("list")
      .setDescription("Show fallback and allowed roles for this server."),
  );

export const applicationCommands = [
  weeklyCheckupCommand.toJSON(),
  allowedRoleCommand.toJSON(),
];
