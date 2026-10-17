import { EmbedBuilder, type User } from "discord.js";
import { APP_VERSION } from "./version.js";

export function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, "") + "…";
}

export function withActor(embed: EmbedBuilder, user: User): EmbedBuilder {
  return embed.setAuthor({
    name: truncate(user.displayName, 256),
    iconURL: user.displayAvatarURL({ size: 128 }),
    url: `https://discord.com/users/${user.id}`,
  });
}

export function formatMentions(
  ids: readonly string[],
  kind: "role" | "user",
): string {
  const lines: string[] = [];
  for (const id of ids) {
    const line = kind === "role" ? `<@&${id}>` : `<@${id}>`;
    if ([...lines, line].join(" · ").length > 900) break;
    lines.push(line);
  }
  const extra = ids.length - lines.length;
  return (
    (lines.join(" · ") || "None configured") +
    (extra > 0 ? `\n…and ${extra} more.` : "")
  );
}

const COLORS = Object.freeze({
  error: 0xed4245,
  info: 0x5865f2,
  neutral: 0x747f8d,
  success: 0x57f287,
  warning: 0xfee75c,
});

type EmbedTone = keyof typeof COLORS;

function buildEmbed(
  tone: EmbedTone,
  title: string,
  description: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS[tone])
    .setTitle(truncate(title, 256))
    .setDescription(truncate(description, 4096))
    .setFooter({ text: `Glixera | Affiliate Services • v${APP_VERSION}` })
    .setTimestamp();
}

export function errorEmbed(title: string, description: string): EmbedBuilder {
  return buildEmbed("error", title, description);
}

export function infoEmbed(title: string, description: string): EmbedBuilder {
  return buildEmbed("info", title, description);
}

export function neutralEmbed(title: string, description: string): EmbedBuilder {
  return buildEmbed("neutral", title, description);
}

export function successEmbed(title: string, description: string): EmbedBuilder {
  return buildEmbed("success", title, description);
}

export function warningEmbed(title: string, description: string): EmbedBuilder {
  return buildEmbed("warning", title, description);
}
