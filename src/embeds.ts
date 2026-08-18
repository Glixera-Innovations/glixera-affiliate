import { EmbedBuilder } from "discord.js";

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
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Glixera | Affiliate Services" });
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
