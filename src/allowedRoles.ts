import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";

import type { AllowedRoleStore } from "./allowedRoleStore.js";
import type { AppConfig } from "./config.js";
import {
  errorEmbed,
  infoEmbed,
  successEmbed,
  warningEmbed,
} from "./embeds.js";

function isConfiguredGuild(config: AppConfig, guildId: string): boolean {
  return config.guildIds.includes(guildId);
}

function canManageAllowedRoles(
  interaction: ChatInputCommandInteraction<"cached">,
  store: AllowedRoleStore,
): boolean {
  return (
    interaction.guild.ownerId === interaction.user.id ||
    store.hasFallbackRole(interaction.member.roles.cache)
  );
}

function canListAllowedRoles(
  interaction: ChatInputCommandInteraction<"cached">,
  store: AllowedRoleStore,
): boolean {
  return (
    interaction.guild.ownerId === interaction.user.id ||
    store.hasAllowedRole(interaction.guildId, interaction.member.roles.cache)
  );
}

function formatRoleList(roleIds: readonly string[]): string {
  return roleIds.length > 0
    ? roleIds.map((roleId) => `• <@&${roleId}>`).join("\n")
    : "_None configured_";
}

async function rejectRoleManager(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.reply({
    embeds: [
      errorEmbed(
        "Access denied",
        "Only the server owner or a fallback management role can change allowed roles.",
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleAllowedRoleCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  store: AllowedRoleStore,
): Promise<void> {
  if (!interaction.inCachedGuild() || !isConfiguredGuild(config, interaction.guildId)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          "Unavailable server",
          "This command is not available in this server.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    if (!canListAllowedRoles(interaction, store)) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            "Access denied",
            "You need an authorized role to view this server's allowed-role list.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const snapshot = store.getSnapshot(interaction.guildId);
    const embed = infoEmbed(
      "Allowed roles",
      `Role access configuration for **${interaction.guild.name}**.`,
    ).addFields(
      {
        name: "Management roles",
        value: formatRoleList(snapshot.fallbackRoleIds),
      },
      {
        name: "Allowed roles",
        value: formatRoleList(snapshot.persistentRoleIds),
      },
    );

    await interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!canManageAllowedRoles(interaction, store)) {
    await rejectRoleManager(interaction);
    return;
  }

  const role = interaction.options.getRole("role", true);

  if (role.id === interaction.guildId || role.managed) {
    await interaction.reply({
      embeds: [
        warningEmbed(
          "Invalid role",
          "Select a normal server role; `@everyone` and managed integration roles are not supported.",
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "add") {
    const result = await store.addPersistentRole(interaction.guildId, role.id);
    const embed =
      result === "added"
        ? successEmbed(
            "Allowed role added",
            `${role} can now use the bot's management commands in this server.`,
          )
        : result === "fallback"
          ? infoEmbed(
              "Role already authorized",
              `${role} is already authorized through the fallback role.`,
            )
          : infoEmbed(
              "Role already authorized",
              `${role} is already in this server's allowed-role list.`,
            );

    await interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "remove") {
    const result = await store.removePersistentRole(interaction.guildId, role.id);
    const embed =
      result === "removed"
        ? successEmbed(
            "Allowed role removed",
            `${role} was removed from this server's allowed-role list.`,
          )
        : result === "fallback"
          ? warningEmbed(
              "Protected fallback role",
              `${role} is protected by the fallback role and cannot be removed in Discord. Update \`ALLOWED_ROLE_IDS\` on Fly if you deliberately want to remove it.`,
            )
          : infoEmbed(
              "Role not found",
              `${role} is not in this server's persistent allowed-role list.`,
            );

    await interaction.reply({
      embeds: [embed],
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [errorEmbed("Unknown action", "That allowed-role action is not supported.")],
    flags: MessageFlags.Ephemeral,
  });
}
