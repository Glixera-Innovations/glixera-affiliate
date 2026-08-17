import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "mcq";
const VERSION = "1";
const SIGNATURE_LENGTH = 16;
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export type CheckupAction = "answer" | "submit" | "close";

export interface CheckupContext {
  readonly partnerRoleId: string;
  readonly responseChannelId: string;
  readonly period: string;
}

export interface ParsedCheckupCustomId extends CheckupContext {
  readonly action: CheckupAction;
}

function actionToCode(action: CheckupAction): string {
  switch (action) {
    case "answer":
      return "a";
    case "submit":
      return "s";
    case "close":
      return "c";
  }
}

function codeToAction(code: string): CheckupAction | null {
  switch (code) {
    case "a":
      return "answer";
    case "s":
      return "submit";
    case "c":
      return "close";
    default:
      return null;
  }
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(value)
    .digest("base64url")
    .slice(0, SIGNATURE_LENGTH);
}

function signaturesMatch(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function encodePeriod(period: string): string {
  return Buffer.from(period, "utf8").toString("base64url");
}

export function createCheckupCustomId(
  action: CheckupAction,
  context: CheckupContext,
  secret: string,
): string {
  if (
    !SNOWFLAKE_PATTERN.test(context.partnerRoleId) ||
    !SNOWFLAKE_PATTERN.test(context.responseChannelId)
  ) {
    throw new Error("Checkup custom IDs require valid Discord role and channel IDs.");
  }

  const period = context.period.trim();

  if (period.length === 0 || period.length > 40) {
    throw new Error("The checkup period must contain between 1 and 40 characters.");
  }

  const unsigned = [
    PREFIX,
    VERSION,
    actionToCode(action),
    context.partnerRoleId,
    context.responseChannelId,
    encodePeriod(period),
  ].join(":");
  const customId = `${unsigned}:${sign(unsigned, secret)}`;

  if (customId.length > 100) {
    throw new Error("The generated Discord component ID is longer than 100 characters.");
  }

  return customId;
}

export function parseCheckupCustomId(
  customId: string,
  secret: string,
): ParsedCheckupCustomId | null {
  const parts = customId.split(":");

  if (parts.length !== 7) {
    return null;
  }

  const [prefix, version, actionCode, partnerRoleId, responseChannelId, encodedPeriod, signature] =
    parts;

  if (
    prefix !== PREFIX ||
    version !== VERSION ||
    !actionCode ||
    !partnerRoleId ||
    !responseChannelId ||
    !encodedPeriod ||
    !signature ||
    !SNOWFLAKE_PATTERN.test(partnerRoleId) ||
    !SNOWFLAKE_PATTERN.test(responseChannelId)
  ) {
    return null;
  }

  const action = codeToAction(actionCode);

  if (!action) {
    return null;
  }

  const unsigned = parts.slice(0, 6).join(":");

  if (!signaturesMatch(signature, sign(unsigned, secret))) {
    return null;
  }

  const period = Buffer.from(encodedPeriod, "base64url").toString("utf8");

  if (
    period.length === 0 ||
    period.length > 40 ||
    encodePeriod(period) !== encodedPeriod
  ) {
    return null;
  }

  return {
    action,
    partnerRoleId,
    responseChannelId,
    period,
  };
}

export function isCheckupCustomId(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}
