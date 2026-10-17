import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CheckupStore, type CheckupRecord } from "../src/checkupStore.js";

export const record: CheckupRecord = {
  id: "test-checkup-1234",
  guildId: "123456789012345678",
  channelId: "234567890123456789",
  messageId: "345678901234567890",
  partnerRoleId: "456789012345678901",
  responseChannelId: "567890123456789012",
  period: "🎉".repeat(20),
  createdAt: Date.now(),
  closedAt: null,
  responses: {},
};
const user = "678901234567890123";
async function withStore(
  run: (store: CheckupStore, path: string) => Promise<void>,
) {
  const path = await mkdtemp(join(tmpdir(), "glixera-checkups-"));
  try {
    const store = new CheckupStore(path);
    await store.initialize();
    await store.create(record);
    await run(store, path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

test("closing a checkup rejects an already-open form and stays closed after restart", async () =>
  withStore(async (store, path) => {
    await store.close(record.id);
    const restarted = new CheckupStore(path);
    await restarted.initialize();
    const result = await restarted.submit(record.id, user, async () => {
      assert.fail("Closed checkups must never send a response");
    });
    assert.equal(result.status, "closed");
  }));

test("simultaneous responses from the same person post once, including after restart", async () =>
  withStore(async (store, path) => {
    let deliveries = 0;
    const deliver = async (nonce: string) => {
      assert.match(nonce, /^[a-f0-9]{24}$/);
      deliveries++;
      return "789012345678901234";
    };
    const results = await Promise.all([
      store.submit(record.id, user, deliver),
      store.submit(record.id, user, deliver),
    ]);
    assert.deepEqual(
      results.map((result) => result.status),
      ["submitted", "duplicate"],
    );
    assert.equal(deliveries, 1);
    const restarted = new CheckupStore(path);
    await restarted.initialize();
    assert.equal(
      (await restarted.submit(record.id, user, deliver)).status,
      "duplicate",
    );
    assert.equal(deliveries, 1);
  }));

test("failed deliveries can be retried with the same Discord deduplication nonce", async () =>
  withStore(async (store, path) => {
    let firstNonce = "";
    await assert.rejects(
      store.submit(record.id, user, async (nonce) => {
        firstNonce = nonce;
        throw new Error("Network unavailable");
      }),
    );
    const restarted = new CheckupStore(path);
    await restarted.initialize();
    const result = await restarted.submit(record.id, user, async (nonce) => {
      assert.equal(nonce, firstNonce);
      return "789012345678901234";
    });
    assert.equal(result.status, "submitted");
  }));

test("an in-flight response completes before a queued close, and later forms are blocked", async () =>
  withStore(async (store) => {
    const results = await Promise.all([
      store.submit(record.id, user, async () => "789012345678901234"),
      store.close(record.id),
    ]);
    assert.equal(results[0].status, "submitted");
    assert.equal(
      (
        await store.submit(record.id, "890123456789012345", async () => {
          assert.fail();
        })
      ).status,
      "closed",
    );
  }));
