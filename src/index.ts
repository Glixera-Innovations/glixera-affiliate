import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} from "discord.js";

import { applicationCommands } from "./commands.js";
import { AllowedRoleStore } from "./allowedRoleStore.js";
import { handleAllowedRoleCommand } from "./allowedRoles.js";
import { loadConfig } from "./config.js";
import { isCheckupCustomId } from "./customIds.js";
import { startHealthServer } from "./health.js";
import {
  handleMonthlyCheckupButton,
  handleMonthlyCheckupCommand,
  handleMonthlyCheckupModal,
} from "./monthlyCheckup.js";

const config = loadConfig();
const allowedRoleStore = new AllowedRoleStore(
  config.dataDirectory,
  config.allowedRoleIds,
);
// Slash-command interactions only require the standard Guilds intent. Privileged
// presence, member-list, and message-content intents deliberately remain disabled.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const healthServer = startHealthServer(config.port, () => client.isReady());

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

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.token);

  for (const guildId of config.guildIds) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), {
      body: applicationCommands,
    });
  }

  console.info(
    `Registered ${applicationCommands.length} guild command(s) in ${config.guildIds.length} server(s).`,
  );
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

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "allowed-role") {
      await handleAllowedRoleCommand(interaction, config, allowedRoleStore);
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "monthly-checkup") {
      await handleMonthlyCheckupCommand(interaction, config, allowedRoleStore);
      return;
    }

    if (interaction.isButton() && isCheckupCustomId(interaction.customId)) {
      await handleMonthlyCheckupButton(interaction, config, allowedRoleStore);
      return;
    }

    if (interaction.isModalSubmit() && isCheckupCustomId(interaction.customId)) {
      await handleMonthlyCheckupModal(interaction, config, allowedRoleStore);
    }
  } catch (error) {
    console.error("Failed to handle a Discord interaction:", describeError(error));

    if (!interaction.isRepliable()) {
      return;
    }

    const content = "Something went wrong while processing that action. Please try again.";

    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content }).catch(() => undefined);
    } else if (interaction.replied) {
      await interaction
        .followUp({ content, flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    } else {
      await interaction
        .reply({ content, flags: MessageFlags.Ephemeral })
        .catch(() => undefined);
    }
  }
});

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

async function main(): Promise<void> {
  await allowedRoleStore.initialize();
  console.info(`Allowed-role store ready at ${allowedRoleStore.filePath}.`);
  await registerCommands();
  await client.login(config.token);
}

main().catch((error: unknown) => {
  console.error("Glixera Affiliate failed to start:", describeError(error));
  healthServer.close(() => process.exit(1));
});
