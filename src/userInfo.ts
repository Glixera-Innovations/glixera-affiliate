import {
  escapeMarkdown,
  MessageFlags,
  type ChatInputCommandInteraction,
  type GuildMember,
  type User,
} from "discord.js";
import type { AllowedRoleStore } from "./allowedRoleStore.js";
import type { AuditLogger } from "./auditLog.js";
import { canManageBot, canOperateBot } from "./access.js";
import {
  errorEmbed,
  formatMentions,
  infoEmbed,
  truncate,
  withActor,
} from "./embeds.js";
import { isSnowflake } from "./storage.js";

const timestamp = (milliseconds: number): string => {
  const seconds = Math.floor(milliseconds / 1000);
  return `<t:${seconds}:D> (<t:${seconds}:R>)`;
};

export function buildUserInfoEmbed(
  user: User,
  member: GuildMember | null,
  store: AllowedRoleStore,
) {
  const avatar = user.displayAvatarURL({ size: 512 });
  const embed = withActor(
    infoEmbed(
      truncate(user.displayName, 256),
      `**@${escapeMarkdown(user.username)}** · [Open profile](https://discord.com/users/${user.id})`,
    ),
    user,
  )
    .setThumbnail(avatar)
    .addFields(
      { name: "Discord ID", value: `\`${user.id}\``, inline: true },
      { name: "Account", value: user.bot ? "Bot" : "User", inline: true },
      { name: "Created", value: timestamp(user.createdTimestamp) },
    );
  if (user.accentColor !== undefined && user.accentColor !== null)
    embed.setColor(user.accentColor);
  if (member) {
    const roles = [...member.roles.cache.values()]
      .filter((role) => role.id !== member.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => role.id);
    embed.addFields(
      {
        name: "Server",
        value: truncate(escapeMarkdown(member.guild.name), 1024),
        inline: true,
      },
      {
        name: "Display name",
        value: truncate(escapeMarkdown(member.displayName), 1024),
        inline: true,
      },
      {
        name: "Joined",
        value: member.joinedTimestamp
          ? timestamp(member.joinedTimestamp)
          : "Unavailable",
      },
      {
        name: `Roles (${roles.length})`,
        value: roles.length ? formatMentions(roles, "role") : "No roles",
      },
      {
        name: "Bot access",
        value: canManageBot(member, store)
          ? "Manager"
          : canOperateBot(member, store)
            ? "Operator"
            : "None",
        inline: true,
      },
    );
    if (member.premiumSinceTimestamp)
      embed.addFields({
        name: "Boosting since",
        value: timestamp(member.premiumSinceTimestamp),
        inline: true,
      });
  } else
    embed.addFields({
      name: "Server membership",
      value: "Not a member of this server.",
    });
  const banner = user.bannerURL({ size: 1024 });
  if (banner) embed.setImage(banner);
  return embed;
}

export async function handleUserInfo(
  interaction: ChatInputCommandInteraction<"cached">,
  store: AllowedRoleStore,
  audit: AuditLogger,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const selected = interaction.options.getUser("user");
  const requestedId = interaction.options.getString("user-id");
  if (
    (selected && requestedId) ||
    (requestedId !== null && !isSnowflake(requestedId))
  ) {
    await interaction.editReply({
      embeds: [
        errorEmbed(
          "Invalid lookup",
          "Choose a user or supply a valid numeric Discord ID, using one option at a time.",
        ),
      ],
    });
    return;
  }
  const id = requestedId ?? selected?.id ?? interaction.user.id;
  let user: User;
  try {
    user = await interaction.client.users.fetch(id, {
      force: true,
      cache: false,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      Number(error.code) === 10013
    ) {
      await interaction.editReply({
        embeds: [
          errorEmbed(
            "User not found",
            "Discord could not find an account with that ID.",
          ),
        ],
      });
      return;
    }
    throw error;
  }
  let member: GuildMember | null = null;
  try {
    member = await interaction.guild.members.fetch({
      user: id,
      force: true,
      cache: false,
    });
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      Number(error.code) === 10007
    ))
      throw error;
  }
  await interaction.editReply({
    embeds: [buildUserInfoEmbed(user, member, store)],
    allowedMentions: { parse: [] },
  });
  await audit.record(interaction.guildId, {
    title: "User lookup",
    description: `Looked up <@${id}> (\`${id}\`).`,
    actor: interaction.user,
  });
}
