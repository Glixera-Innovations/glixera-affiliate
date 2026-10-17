import { createServer, type Server } from "node:http";

export function startHealthServer(
  port: number,
  isDiscordReady: () => boolean,
  host = "127.0.0.1",
): Server {
  const server = createServer((request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ status: "method-not-allowed" }));
      return;
    }

    if (request.url !== "/health" && request.url !== "/ready") {
      response.writeHead(404, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ status: "not-found" }));
      return;
    }

    const ready = isDiscordReady();
    response.writeHead(request.url === "/ready" && !ready ? 503 : 200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        status: "ok",
        discord: ready ? "connected" : "connecting",
      }),
    );
  });

  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.listen(port, host, () => {
    const address = server.address();
    const listeningPort =
      typeof address === "object" && address !== null ? address.port : port;
    console.info(`Health server listening on ${host}:${listeningPort}`);
  });

  return server;
}
