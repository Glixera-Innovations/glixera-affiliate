import { ChannelType, SlashCommandBuilder } from "discord.js";

export const weeklyCheckupCommand = new SlashCommandBuilder()
  .setName("weekly-checkup")
  .setDescription("Send Glixera's weekly questionnaire to a partnership role.")
  .addRoleOption((option) =>
    option
      .setName("partner-role")
      .setDescription("The partnership role to contact.")
      .setRequired(true),
  )
  .addChannelOption((option) =>
    option
      .setName("questionnaire-channel")
      .setDescription("Where the questionnaire and role ping are posted.")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addChannelOption((option) =>
    option
      .setName("response-channel")
      .setDescription(
        "Where completed answers go; defaults to the questionnaire channel.",
      )
      .addChannelTypes(ChannelType.GuildText),
  )
  .addStringOption((option) =>
    option
      .setName("period")
      .setDescription("For example: Week of 17–23 Aug 2026.")
      .setMaxLength(40),
  );

function accessCommand(subject: "role" | "user"): SlashCommandBuilder {
  const command = new SlashCommandBuilder()
    .setName(`allowed-${subject}`)
    .setDescription(`Manage bot access for server ${subject}s.`);
  command.addSubcommand((sub) => {
    sub
      .setName("add")
      .setDescription(`Give a ${subject} operator or manager access.`);
    if (subject === "role")
      sub.addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("The server role to authorize.")
          .setRequired(true),
      );
    else
      sub.addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The server member to authorize.")
          .setRequired(true),
      );
    return sub.addStringOption((option) =>
      option
        .setName("level")
        .setDescription(
          "Operators run the bot; managers also control access and settings.",
        )
        .addChoices(
          { name: "Operator", value: "operator" },
          { name: "Manager", value: "manager" },
        ),
    );
  });
  command.addSubcommand((sub) => {
    sub
      .setName("remove")
      .setDescription(`Remove a ${subject}'s explicitly granted bot access.`);
    if (subject === "role")
      return sub.addRoleOption((option) =>
        option
          .setName("role")
          .setDescription("The role to remove.")
          .setRequired(true),
      );
    return sub.addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The user to remove.")
        .setRequired(true),
    );
  });
  command.addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("Show all operator and manager access in this server."),
  );
  return command;
}

export const allowedRoleCommand = accessCommand("role");
export const allowedUserCommand = accessCommand("user");

export const botSettingsCommand = new SlashCommandBuilder()
  .setName("bot-settings")
  .setDescription("View bot settings and configure usage logging.")
  .addSubcommand((sub) =>
    sub.setName("show").setDescription("View this server's bot configuration."),
  )
  .addSubcommand((sub) =>
    sub
      .setName("log-channel")
      .setDescription("Set the channel for bot usage logs.")
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("A private management text channel is recommended.")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("disable-logs").setDescription("Stop posting new usage logs."),
  )
  .addSubcommand((sub) =>
    sub
      .setName("test-log")
      .setDescription("Verify that the bot can post a usage log."),
  );

export const userInfoCommand = new SlashCommandBuilder()
  .setName("user-info")
  .setDescription("Look up a Discord user and their server membership.")
  .addUserOption((option) =>
    option
      .setName("user")
      .setDescription("Select a user, or leave empty to look up yourself."),
  )
  .addStringOption((option) =>
    option
      .setName("user-id")
      .setDescription("Look up a Discord ID instead of selecting a user.")
      .setMinLength(17)
      .setMaxLength(20),
  );

export const applicationCommands = [
  weeklyCheckupCommand,
  allowedRoleCommand,
  allowedUserCommand,
  botSettingsCommand,
  userInfoCommand,
].map((command) => command.toJSON());
