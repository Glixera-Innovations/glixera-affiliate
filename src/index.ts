import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} from "discord.js";
import type { Server } from "node:http";

import { applicationCommands } from "./commands.js";
import { AllowedRoleStore } from "./allowedRoleStore.js";
import { handleAllowedRoleCommand } from "./allowedRoles.js";
import { loadConfig } from "./config.js";
import { isCheckupCustomId } from "./customIds.js";
import { isDiscordMissingAccessError } from "./discordErrors.js";
import { errorEmbed } from "./embeds.js";
import {
  handleWeeklyCheckupButton,
  handleWeeklyCheckupCommand,
  handleWeeklyCheckupModal,
} from "./weeklyCheckup.js";

const config = loadConfig();
const allowedRoleStore = new AllowedRoleStore(
  config.dataDirectory,
  config.allowedRoleIds,
);
// Slash-command interactions only require the standard Guilds intent.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const discordRest = new REST({ version: "10" }).setToken(config.token);

function describeError(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { type: typeof error };
}

async function registerCommandsForGuild(guildId: string): Promise<boolean> {
  try {
    await discordRest.put(Routes.applicationGuildCommands(config.clientId, guildId), {
      body: applicationCommands,
    });
    console.info(
      `Registered ${applicationCommands.length} guild command(s) in server ${guildId}.`,
    );
    return true;
  } catch (error) {
    if (!isDiscordMissingAccessError(error)) {
      throw error;
    }

    console.warn(
      `Skipped command registration for server ${guildId}: the application is not installed there or lacks the applications.commands scope.`,
    );
    return false;
  }
}

async function registerCommands(): Promise<void> {
  let registeredGuilds = 0;

  for (const guildId of config.guildIds) {
    if (await registerCommandsForGuild(guildId)) {
      registeredGuilds += 1;
    }
  }

  console.info(`Command registration completed for ${registeredGuilds} server(s).`);
}

client.once(Events.ClientReady, (readyClient) => {
  console.info(`Discord client ready as ${readyClient.user.tag}.`);
  console.info(
    `Configured servers: ${config.guildIds.join(", ")} • Time zone: ${config.timeZone}`,
  );
});

client.on(Events.Warn, (warning) => {
  console.warn("Discord warning:", warning);
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", describeError(error));
});

client.on(Events.GuildCreate, (guild) => {
  if (!config.guildIds.includes(guild.id)) {
    return;
  }

  void registerCommandsForGuild(guild.id).catch((error: unknown) => {
    console.error(
      `Failed to register commands after joining server ${guild.id}:`,
      describeError(error),
    );
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "allowed-role") {
      await handleAllowedRoleCommand(interaction, config, allowedRoleStore);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "weekly-checkup") {
      await handleWeeklyCheckupCommand(interaction, config, allowedRoleStore);
      return;
    }

    if (interaction.isButton() && isCheckupCustomId(interaction.customId)) {
      await handleWeeklyCheckupButton(interaction, config, allowedRoleStore);
      return;
    }

    if (interaction.isModalSubmit() && isCheckupCustomId(interaction.customId)) {
      await handleWeeklyCheckupModal(interaction, config, allowedRoleStore);
    }
  } catch (error) {
    console.error("Failed to handle a Discord interaction:", describeError(error));

    if (!interaction.isRepliable()) {
      return;
    }

    const embeds = [
      errorEmbed(
        "Something went wrong",
        "The action could not be completed. Please try again or contact management if the problem continues.",
      ),
    ];

    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ embeds }).catch(() => undefined);
    } else if (interaction.replied) {
      await interaction
        .followUp({ embeds, flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    } else {
      await interaction
        .reply({ embeds, flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    }
  }
});

export async function startBot(healthServer: Server): Promise<() => boolean> {
  let isShuttingDown = false;

  function shutDown(signal: NodeJS.Signals): void {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    console.info(`Received ${signal}; shutting down.`);
    client.destroy();
    healthServer.close(() => process.exit(0));

    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.once("SIGINT", shutDown);
  process.once("SIGTERM", shutDown);

  await allowedRoleStore.initialize();
  console.info(`Allowed-role store ready at ${allowedRoleStore.filePath}.`);
  await registerCommands();
  await client.login(config.token);

  return () => client.isReady();
}
