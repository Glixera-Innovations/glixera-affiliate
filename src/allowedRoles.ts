import {
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";

import type { AllowedRoleStore } from "./allowedRoleStore.js";
import type { AppConfig } from "./config.js";

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
    content:
      "Only the server owner or a fallback management role can change allowed roles.",
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
      content: "This command is not available in this server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "list") {
    if (!canListAllowedRoles(interaction, store)) {
      await interaction.reply({
        content: "You need an authorized role to view this server's allowed-role list.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const snapshot = store.getSnapshot(interaction.guildId);
    await interaction.reply({
      content: [
        `**Allowed roles for ${interaction.guild.name}**`,
        "",
        "**Fallback roles (Fly secrets; protected)**",
        formatRoleList(snapshot.fallbackRoleIds),
        "",
        "**Persistent roles (/data)**",
        formatRoleList(snapshot.persistentRoleIds),
      ].join("\n"),
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
      content: "Select a normal server role; `@everyone` and managed integration roles are not supported.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "add") {
    const result = await store.addPersistentRole(interaction.guildId, role.id);
    const content =
      result === "added"
        ? `${role} can now use the bot's management commands in this server.`
        : result === "fallback"
          ? `${role} is already authorized through the fallback role.`
          : `${role} is already in this server's allowed-role list.`;

    await interaction.reply({
      content,
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === "remove") {
    const result = await store.removePersistentRole(interaction.guildId, role.id);
    const content =
      result === "removed"
        ? `${role} was removed from this server's persistent allowed-role list.`
        : result === "fallback"
          ? `${role} is protected by the fallback role and cannot be removed from Discord. Update ALLOWED_ROLE_IDS on Fly if you deliberately want to remove it.`
          : `${role} is not in this server's persistent allowed-role list.`;

    await interaction.reply({
      content,
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: "Unknown allowed-role action.",
    flags: MessageFlags.Ephemeral,
  });
}
