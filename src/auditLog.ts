import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type EmbedField,
  type User,
} from "discord.js";
import type { AllowedRoleStore } from "./allowedRoleStore.js";
import { infoEmbed, truncate, withActor } from "./embeds.js";

export interface AuditEvent {
  title: string;
  description: string;
  actor?: User;
  fields?: EmbedField[];
}

/** Metadata only: feedback text, tokens and private message content are never logged. */
export class AuditLogger {
  #pending = 0;
  constructor(
    readonly client: Client,
    readonly store: AllowedRoleStore,
  ) {}

  async record(
    guildId: string,
    event: AuditEvent,
    channelOverride?: string,
  ): Promise<boolean> {
    const channelId =
      channelOverride ?? this.store.getSnapshot(guildId).logChannelId;
    if (!channelId) return false;
    if (this.#pending >= 25) {
      console.warn("Usage log queue is full; dropped a log entry.");
      return false;
    }
    this.#pending += 1;
    try {
      const guild = this.client.guilds.cache.get(guildId);
      const channel = await guild?.channels.fetch(channelId);
      const bot = guild?.members.me;
      if (
        !channel ||
        channel.type !== ChannelType.GuildText ||
        !bot ||
        !channel
          .permissionsFor(bot)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
          ])
      ) {
        console.warn(
          `Cannot write usage logs in server ${guildId}; check the configured channel and bot permissions.`,
        );
        return false;
      }
      const embed = infoEmbed(event.title, event.description);
      if (event.actor) {
        withActor(embed, event.actor);
        embed.addFields({
          name: "User",
          value: `<@${event.actor.id}> · \`${event.actor.id}\``,
          inline: false,
        });
      }
      if (event.fields)
        embed.addFields(
          event.fields.slice(0, 8).map((field) => ({
            name: truncate(field.name, 256),
            value: truncate(field.value || "—", 1024),
            inline: field.inline,
          })),
        );
      const icon = guild.iconURL({ size: 128 });
      if (icon) embed.setThumbnail(icon);
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
      return true;
    } catch {
      console.warn(`Could not deliver a usage log in server ${guildId}.`);
      return false;
    } finally {
      this.#pending -= 1;
    }
  }
}
