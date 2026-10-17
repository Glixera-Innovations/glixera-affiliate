import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type {
  AccessLevel,
  AccessSubject,
  AllowedRoleStore,
} from "./allowedRoleStore.js";
import type { AuditLogger } from "./auditLog.js";
import {
  errorEmbed,
  formatMentions,
  infoEmbed,
  successEmbed,
  withActor,
} from "./embeds.js";

export async function handleAccessCommand(
  interaction: ChatInputCommandInteraction<"cached">,
  store: AllowedRoleStore,
  audit: AuditLogger,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subject: AccessSubject =
    interaction.commandName === "allowed-user" ? "user" : "role";
  const action = interaction.options.getSubcommand();
  if (!["add", "remove", "list"].includes(action))
    throw new Error("Unknown access action.");
  if (action === "list") {
    const snapshot = store.getSnapshot(interaction.guildId);
    const embed = withActor(
      infoEmbed(
        "Bot access",
        "Operators run checkups and look up users. Managers can also grant access and change settings. Server owners and Discord administrators always have manager access.",
      ),
      interaction.user,
    ).addFields(
      {
        name: "Operator roles",
        value: formatMentions(snapshot.roleIds, "role"),
      },
      {
        name: "Manager roles",
        value: formatMentions(snapshot.managerRoleIds, "role"),
      },
      { name: "Operators", value: formatMentions(snapshot.userIds, "user") },
      {
        name: "Managers",
        value: formatMentions(snapshot.managerUserIds, "user"),
      },
    );
    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    return;
  }
  const role =
    subject === "role" ? interaction.options.getRole("role", true) : null;
  const user =
    subject === "user" ? interaction.options.getUser("user", true) : null;
  if (role && (role.id === interaction.guildId || role.managed)) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Invalid role",
          "Choose a regular server role. Everyone and integration roles cannot receive bot access.",
        ),
      ],
    });
    return;
  }
  if (user?.bot) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Invalid user",
          "Choose a person rather than a bot account.",
        ),
      ],
    });
    return;
  }
  // A removed user may no longer belong to the server; removals must still work.
  if (
    user &&
    action === "add" &&
    !(await interaction.guild.members.fetch(user.id).catch(() => null))
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "User unavailable",
          "The selected user must currently belong to this server.",
        ),
      ],
    });
    return;
  }
  const id = (role ?? user)!.id;
  const mention = subject === "role" ? `<@&${id}>` : `<@${id}>`;
  const requestedLevel = interaction.options.getString("level") ?? "operator";
  if (requestedLevel !== "operator" && requestedLevel !== "manager")
    throw new Error("Unknown access level.");
  const level: AccessLevel = requestedLevel;
  const changed =
    action === "add"
      ? await store.setAccess(interaction.guildId, subject, id, level)
      : await store.removeAccess(interaction.guildId, subject, id);
  const embed = withActor(
    successEmbed(
      changed ? "Bot access updated" : "No change needed",
      action === "add"
        ? `${mention} has **${level}** access in this server.`
        : `${mention}'s explicitly granted bot access has been removed. Other roles and Discord administrator permissions still apply.`,
    ),
    interaction.user,
  );
  await interaction.editReply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
  if (changed)
    await audit.record(interaction.guildId, {
      title: "Bot access changed",
      description:
        action === "add"
          ? `Granted **${level}** access to ${mention}.`
          : `Removed explicit access for ${mention}.`,
      actor: interaction.user,
    });
}
