import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalSubmitFields,
  type User,
} from "discord.js";
import type { AppConfig } from "./config.js";
import type { CheckupRecord } from "./checkupStore.js";
import { createStoredCheckupCustomId } from "./customIds.js";
import { withActor } from "./embeds.js";
import { APP_VERSION } from "./version.js";

export interface CheckupAnswers {
  announcements: string;
  events: string;
  feedback: string;
  rating: number;
}

export function parseRating(values: readonly string[]): number | null {
  const value = values[0];
  return values.length === 1 && value !== undefined && /^[1-5]$/.test(value)
    ? Number(value)
    : null;
}

export function readCheckupAnswers(
  fields: Pick<
    ModalSubmitFields,
    "getTextInputValue" | "getStringSelectValues"
  >,
): CheckupAnswers | null {
  try {
    const announcements = fields.getTextInputValue("announcements").trim();
    const events = fields.getTextInputValue("events").trim();
    const feedback = fields.getTextInputValue("feedback").trim();
    const rating = parseRating(fields.getStringSelectValues("rating"));
    if (
      rating === null ||
      [announcements, events, feedback].some(
        (value) => value.length < 1 || value.length > 1000,
      )
    )
      return null;
    return { announcements, events, feedback, rating };
  } catch {
    return null;
  }
}

export function formatRating(rating: number): string {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new Error("Rating must be between 1 and 5.");
  return `${"★".repeat(rating)}${"☆".repeat(5 - rating)} · ${rating}/5`;
}

export function buildQuestionnaireEmbed(
  period: string,
  requestedBy: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Weekly Partnership Checkup • ${period}`)
    .setDescription(
      "Hello! It is time for our weekly Glixera Innovations partnership checkup. Please have one representative answer using the button below.",
    )
    .addFields(
      {
        name: "Announcements",
        value:
          "What announcements would you like Glixera to share? Include your preferred posting dates, or write “None”.",
      },
      {
        name: "Events",
        value:
          "What events should we promote or participate in? Include dates and times, or write “None”.",
      },
      {
        name: "Partnership experience",
        value: "What is working well, and what could we improve?",
      },
      {
        name: "Partnership rating",
        value:
          "Choose **1–5 stars** after your written feedback. All four answers are required.",
      },
    )
    .setFooter({
      text: `Requested by ${requestedBy} • Management can close this checkup when complete.`,
    });
}

export function buildCheckupButtons(
  record: Pick<CheckupRecord, "id" | "guildId">,
  config: AppConfig,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(
        createStoredCheckupCustomId(
          "answer",
          record.guildId,
          record.id,
          config.customIdSecret,
        ),
      )
      .setLabel("Answer checkup")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(
        createStoredCheckupCustomId(
          "close",
          record.guildId,
          record.id,
          config.customIdSecret,
        ),
      )
      .setLabel("Close checkup")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

export function buildAnswerModal(
  record: CheckupRecord,
  config: AppConfig,
): ModalBuilder {
  const input = (id: string, placeholder: string) =>
    new TextInputBuilder()
      .setCustomId(id)
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(placeholder)
      .setMinLength(1)
      .setMaxLength(1000)
      .setRequired(true);
  const rating = new StringSelectMenuBuilder()
    .setCustomId("rating")
    .setPlaceholder("Choose your partnership rating")
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true)
    .addOptions(
      ["Very poor", "Poor", "Okay", "Good", "Excellent"].map(
        (description, index) => ({
          label: `${"★".repeat(index + 1)}${"☆".repeat(4 - index)} · ${index + 1} ${index === 0 ? "star" : "stars"}`,
          value: String(index + 1),
          description,
        }),
      ),
    );
  return new ModalBuilder()
    .setCustomId(
      createStoredCheckupCustomId(
        "submit",
        record.guildId,
        record.id,
        config.customIdSecret,
      ),
    )
    .setTitle("Weekly partnership checkup")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Announcements to share")
        .setTextInputComponent(
          input(
            "announcements",
            "Include the announcement and preferred posting date, or write “None”.",
          ),
        ),
      new LabelBuilder()
        .setLabel("Upcoming events")
        .setTextInputComponent(
          input(
            "events",
            "Include dates, times, time zone, and how Glixera can help, or write “None”.",
          ),
        ),
      new LabelBuilder()
        .setLabel("Partnership feedback")
        .setTextInputComponent(
          input(
            "feedback",
            "Tell us what is working well and what we could improve.",
          ),
        ),
      new LabelBuilder()
        .setLabel("Partnership rating")
        .setDescription("How would you rate your partnership with Glixera?")
        .setStringSelectMenuComponent(rating),
    );
}

function asCodeBlock(value: string): string {
  return `\`\`\`\n${value.replaceAll("`", "ˋ")}\n\`\`\``;
}

export function buildResponseEmbed(
  record: CheckupRecord,
  answers: CheckupAnswers,
  user: User,
  responseId: string,
): EmbedBuilder {
  return withActor(
    new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`Weekly Checkup Response • ${record.period}`)
      .setDescription(`Partnership: <@&${record.partnerRoleId}>`)
      .setThumbnail(user.displayAvatarURL({ size: 256 })),
    user,
  )
    .addFields(
      { name: "Announcements", value: asCodeBlock(answers.announcements) },
      { name: "Events", value: answers.events },
      { name: "Partnership feedback", value: answers.feedback },
      { name: "Partnership rating", value: formatRating(answers.rating) },
      {
        name: "Submitted by",
        value: `<@${user.id}> · \`${user.id}\``,
        inline: true,
      },
      {
        name: "Partnership role",
        value: `<@&${record.partnerRoleId}>`,
        inline: true,
      },
    )
    .setFooter({ text: `Glixera • v${APP_VERSION} • Response ${responseId}` })
    .setTimestamp();
}
