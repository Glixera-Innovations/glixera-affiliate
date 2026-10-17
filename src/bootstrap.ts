import { once } from "node:events";
import { parseHealthHost, parsePort } from "./config.js";
import { describeError } from "./errors.js";
import { startHealthServer } from "./health.js";

let isDiscordReady = (): boolean => false;
const server = startHealthServer(
  parsePort(process.env.PORT),
  () => isDiscordReady(),
  parseHealthHost(process.env.HEALTH_HOST),
);
try {
  await once(server, "listening");
  const { startBot } = await import("./index.js");
  isDiscordReady = await startBot(server);
} catch (error) {
  console.error(
    "Glixera Affiliate failed to start:",
    describeError(error, [
      process.env.DISCORD_TOKEN ?? "",
      process.env.CUSTOM_ID_SECRET ?? "",
    ]),
  );
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 3000).unref();
}
