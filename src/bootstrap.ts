import { once } from "node:events";

import { startHealthServer } from "./health.js";

function readPort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "8080", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return port;
}

function describeError(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return { type: typeof error };
}

let isDiscordReady = (): boolean => false;
const healthServer = startHealthServer(
  readPort(process.env.PORT),
  () => isDiscordReady(),
);

try {
  await once(healthServer, "listening");

  // Load Discord.js and the bot only after the health listener is bound.
  const { startBot } = await import("./index.js");
  isDiscordReady = await startBot(healthServer);
} catch (error) {
  console.error("Glixera Affiliate failed to start:", describeError(error));
  healthServer.close(() => process.exit(1));
}
