import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { startHealthServer } from "../src/health.js";

test("health server binds externally and responds while Discord connects", async () => {
  const server = startHealthServer(0, () => false);

  try {
    if (!server.listening) {
      await once(server, "listening");
    }

    const address = server.address() as AddressInfo;
    assert.equal(address.address, "0.0.0.0");
    const { port } = address;
    const result = await new Promise<{ statusCode: number; body: string }>(
      (resolve, reject) => {
        const healthRequest = request(
          {
            host: "127.0.0.1",
            method: "GET",
            path: "/health",
            port,
          },
          (response) => {
            const chunks: Buffer[] = [];

            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => {
              resolve({
                statusCode: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );

        healthRequest.once("error", reject);
        healthRequest.end();
      },
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body), {
      status: "ok",
      discord: "connecting",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
