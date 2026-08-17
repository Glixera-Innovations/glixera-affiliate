import { createServer, type Server } from "node:http";

export function startHealthServer(port: number, isDiscordReady: () => boolean): Server {
  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "method-not-allowed" }));
      return;
    }

    if (request.url !== "/health") {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ status: "not-found" }));
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        status: "ok",
        discord: isDiscordReady() ? "connected" : "connecting",
      }),
    );
  });

  server.listen(port, "0.0.0.0", () => {
    console.info(`Health server listening on 0.0.0.0:${port}`);
  });

  return server;
}
