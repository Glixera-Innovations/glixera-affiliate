import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  type BaseInteraction,
} from "discord.js";
import type { Server } from "node:http";
import { applicationCommands } from "./commands.js";
import { AllowedRoleStore } from "./allowedRoleStore.js";
import { handleAccessCommand } from "./allowedRoles.js";
import { canManageBot, canOperateBot } from "./access.js";
import { AuditLogger } from "./auditLog.js";
import { handleBotSettings } from "./botSettings.js";
import { CheckupStore } from "./checkupStore.js";
import { loadConfig } from "./config.js";
import { isCheckupCustomId } from "./customIds.js";
import { isDiscordMissingAccessError } from "./discordErrors.js";
import { errorEmbed } from "./embeds.js";
import { describeError } from "./errors.js";
import { handleUserInfo } from "./userInfo.js";
import { APP_VERSION } from "./version.js";
import {
  handleWeeklyCheckupButton,
  handleWeeklyCheckupCommand,
  handleWeeklyCheckupModal,
} from "./weeklyCheckup.js";

export function commandAccessLevel(
  name: string,
  subcommand: string | null,
): "manager" | "operator" | null {
  if (name === "allowed-role" || name === "allowed-user")
    return subcommand === "list" ? "operator" : "manager";
  if (name === "bot-settings")
    return subcommand === "show" ? "operator" : "manager";
  return name === "weekly-checkup" || name === "user-info" ? "operator" : null;
}

export async function startBot(healthServer: Server): Promise<() => boolean> {
  const config = loadConfig();
  const access = new AllowedRoleStore(
    config.dataDirectory,
    config.allowedRoleIds,
  );
  const checkups = new CheckupStore(config.dataDirectory);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    allowedMentions: { parse: [] },
  });
  const rest = new REST({ version: "10" }).setToken(config.token);
  const audit = new AuditLogger(client, access);
  const secrets = [config.token, config.customIdSecret];
  let shuttingDown = false;
  const activeInteractions = new Set<Promise<void>>();

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Received ${signal}; shutting down.`);
    const timeout = setTimeout(() => process.exit(1), 8_000);
    timeout.unref();
    try {
      // Let acknowledged actions finish their atomic writes before stopping.
      await Promise.allSettled([...activeInteractions]);
      await client.destroy();
      healthServer.close(() => process.exit(0));
    } catch (error) {
      console.error("Shutdown failed:", describeError(error, secrets));
      healthServer.close(() => process.exit(1));
    }
  }
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  async function registerGuild(guildId: string): Promise<boolean> {
    try {
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, guildId),
        { body: applicationCommands },
      );
      console.info(
        `Registered ${applicationCommands.length} commands in server ${guildId}.`,
      );
      return true;
    } catch (error) {
      if (!isDiscordMissingAccessError(error)) throw error;
      console.warn(
        `Cannot register commands in server ${guildId}; check installation and applications.commands scope.`,
      );
      return false;
    }
  }

  client.once(Events.ClientReady, (readyClient) =>
    console.info(
      `Glixera Affiliate v${APP_VERSION} ready as ${readyClient.user.tag}.`,
    ),
  );
  client.on(Events.Warn, (warning) =>
    console.warn("Discord warning:", describeError(warning, secrets)),
  );
  client.on(Events.Error, (error) =>
    console.error("Discord client error:", describeError(error, secrets)),
  );
  client.on(Events.GuildCreate, (guild) => {
    if (config.guildIds.includes(guild.id))
      void registerGuild(guild.id).catch((error: unknown) =>
        console.error(
          "Command registration failed:",
          describeError(error, secrets),
        ),
      );
  });

  async function reportError(
    interaction: BaseInteraction,
    error: unknown,
  ): Promise<void> {
    console.error("Discord interaction failed:", describeError(error, secrets));
    if (!interaction.isRepliable()) return;
    const embeds = [
      errorEmbed(
        "Something went wrong",
        "The action could not be completed. Check whether it took effect before retrying, or contact management.",
      ),
    ];
    if (interaction.deferred && !interaction.replied)
      await interaction.editReply({ embeds }).catch(() => undefined);
    else if (interaction.replied)
      await interaction
        .followUp({ embeds, flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    else
      await interaction
        .reply({ embeds, flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    if (interaction.guildId && config.guildIds.includes(interaction.guildId))
      await audit.record(interaction.guildId, {
        title: "Bot action failed",
        description:
          "An action failed. Check the bot's server logs for technical details.",
        actor: interaction.user,
      });
  }

  client.on(Events.InteractionCreate, (interaction) => {
    if (shuttingDown) return;
    const task = (async () => {
      if (interaction.isChatInputCommand()) {
        if (
          !interaction.inCachedGuild() ||
          !config.guildIds.includes(interaction.guildId)
        ) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Unavailable server",
                "This command is only available in a configured server.",
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const subcommand = interaction.options.getSubcommand(false);
        const required = commandAccessLevel(
          interaction.commandName,
          subcommand,
        );
        if (!required) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Unknown command",
                "This command is outdated. Reopen the slash-command picker and try again.",
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const permitted =
          required === "manager"
            ? canManageBot(interaction.member, access)
            : canOperateBot(interaction.member, access);
        if (!permitted) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                "Access denied",
                `This action requires **${required}** bot access. A server owner, Discord administrator or bot manager can grant it.`,
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          await audit.record(interaction.guildId, {
            title: "Command access denied",
            description: `Blocked \`/${interaction.commandName}${subcommand ? ` ${subcommand}` : ""}\`.`,
            actor: interaction.user,
          });
          return;
        }
        // Best-effort usage logging cannot delay the three-second interaction acknowledgement.
        void audit.record(interaction.guildId, {
          title: "Command used",
          description: `Used \`/${interaction.commandName}${subcommand ? ` ${subcommand}` : ""}\` in <#${interaction.channelId}>.`,
          actor: interaction.user,
        });
        if (
          interaction.commandName === "allowed-role" ||
          interaction.commandName === "allowed-user"
        )
          await handleAccessCommand(interaction, access, audit);
        else if (interaction.commandName === "bot-settings")
          await handleBotSettings(interaction, access, audit);
        else if (interaction.commandName === "user-info")
          await handleUserInfo(interaction, access, audit);
        else
          await handleWeeklyCheckupCommand(
            interaction,
            config,
            access,
            checkups,
            audit,
          );
      } else if (
        interaction.isButton() &&
        isCheckupCustomId(interaction.customId)
      ) {
        await handleWeeklyCheckupButton(
          interaction,
          config,
          access,
          checkups,
          audit,
        );
      } else if (
        interaction.isModalSubmit() &&
        isCheckupCustomId(interaction.customId)
      ) {
        await handleWeeklyCheckupModal(
          interaction,
          config,
          access,
          checkups,
          audit,
        );
      }
    })().catch((error: unknown) =>
      reportError(interaction, error).catch(() => undefined),
    );
    activeInteractions.add(task);
    void task.then(() => activeInteractions.delete(task));
  });

  try {
    await access.initialize(config.guildIds);
    await checkups.initialize();
    let registered = 0;
    for (const guildId of config.guildIds)
      if (await registerGuild(guildId)) registered += 1;
    if (registered === 0)
      throw new Error(
        "No configured servers accepted command registration. Check the bot's installation and server IDs.",
      );
    await client.login(config.token);
    for (const guildId of config.guildIds)
      void audit.record(guildId, {
        title: "Bot online",
        description: `Glixera Affiliate v${APP_VERSION} has started.`,
      });
    return () => !shuttingDown && client.isReady();
  } catch (error) {
    await client.destroy();
    throw error;
  }
}
