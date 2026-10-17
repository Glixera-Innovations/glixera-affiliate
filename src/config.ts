const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export interface AppConfig {
  readonly token: string;
  readonly clientId: string;
  readonly guildIds: readonly string[];
  readonly allowedRoleIds: readonly string[];
  readonly customIdSecret: string;
  readonly dataDirectory: string;
  readonly timeZone: string;
  readonly port: number;
}

function requireValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requireSnowflake(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = requireValue(environment, name);

  if (!SNOWFLAKE_PATTERN.test(value)) {
    throw new Error(`${name} must contain a valid Discord ID.`);
  }

  return value;
}

function parseAllowedRoleIds(
  environment: NodeJS.ProcessEnv,
): readonly string[] {
  const values = (environment.ALLOWED_ROLE_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.some((value) => !SNOWFLAKE_PATTERN.test(value))) {
    throw new Error(
      "ALLOWED_ROLE_IDS must contain one or more comma-separated Discord role IDs.",
    );
  }

  return Object.freeze([...new Set(values)]);
}

function parseGuildIds(environment: NodeJS.ProcessEnv): readonly string[] {
  const configuredGuildIds =
    environment.DISCORD_GUILD_IDS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  const legacyGuildId = environment.DISCORD_GUILD_ID?.trim();
  const values = legacyGuildId
    ? [...configuredGuildIds, legacyGuildId]
    : configuredGuildIds;

  if (values.length === 0) {
    throw new Error(
      "Missing required environment variable: DISCORD_GUILD_IDS (or legacy DISCORD_GUILD_ID).",
    );
  }

  if (values.some((value) => !SNOWFLAKE_PATTERN.test(value))) {
    throw new Error(
      "DISCORD_GUILD_IDS must contain one or more comma-separated Discord server IDs.",
    );
  }

  return Object.freeze([...new Set(values)]);
}

function parseDataDirectory(value: string | undefined): string {
  return value?.trim() || "./data";
}

export function parsePort(value: string | undefined): number {
  const input = value ?? "8080";
  const port = /^\d+$/.test(input) ? Number(input) : Number.NaN;

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

export function parseHealthHost(value: string | undefined): string {
  const host = value ?? "127.0.0.1";
  if (!["127.0.0.1", "0.0.0.0", "::1", "::"].includes(host))
    throw new Error("HEALTH_HOST must be a loopback or wildcard IP address.");
  return host;
}

function parseTimeZone(value: string | undefined): string {
  const timeZone = value?.trim() || "Europe/Brussels";

  try {
    new Intl.DateTimeFormat("en-GB", { timeZone }).format();
  } catch {
    throw new Error(
      `TIME_ZONE is not a recognized IANA time zone: ${timeZone}`,
    );
  }

  return timeZone;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const customIdSecret = requireValue(environment, "CUSTOM_ID_SECRET");

  if (customIdSecret.length < 32) {
    throw new Error("CUSTOM_ID_SECRET must contain at least 32 characters.");
  }

  return Object.freeze({
    token: requireValue(environment, "DISCORD_TOKEN"),
    clientId: requireSnowflake(environment, "DISCORD_CLIENT_ID"),
    guildIds: parseGuildIds(environment),
    allowedRoleIds: parseAllowedRoleIds(environment),
    customIdSecret,
    dataDirectory: parseDataDirectory(environment.DATA_DIR),
    timeZone: parseTimeZone(environment.TIME_ZONE),
    port: parsePort(environment.PORT),
  });
}
