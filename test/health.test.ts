import assert from "node:assert/strict";
import { once } from "node:events";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { startHealthServer } from "../src/health.js";

test("health server defaults to loopback and responds while Discord connects", async () => {
  const server = startHealthServer(0, () => false);

  try {
    if (!server.listening) {
      await once(server, "listening");
    }

    const address = server.address() as AddressInfo;
    assert.equal(address.address, "127.0.0.1");
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

test("readiness is distinct from liveness and container wildcard binding remains supported", async () => {
  let ready = false;
  const server = startHealthServer(0, () => ready, "0.0.0.0");
  try {
    if (!server.listening) await once(server, "listening");
    const address = server.address() as AddressInfo;
    assert.equal(address.address, "0.0.0.0");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/ready`)).status, 503);
    ready = true;
    assert.equal((await fetch(`${base}/ready`)).status, 200);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    assert.equal(
      (await fetch(`${base}/health`, { method: "POST" })).status,
      405,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
