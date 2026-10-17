import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  isRecord,
  isSnowflake,
  MutationQueue,
  readStoredJson,
  writeStoredJson,
} from "./storage.js";

export interface CheckupRecord {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  partnerRoleId: string;
  responseChannelId: string;
  period: string;
  createdAt: number;
  closedAt: number | null;
  responses: Record<string, { nonce: string; messageId: string | null }>;
}
interface StoredCheckups {
  version: 1;
  checkups: Record<string, CheckupRecord>;
}
export type SubmissionResult =
  | { status: "submitted"; messageId: string }
  | { status: "closed" | "duplicate" | "missing" };
const CONTROL_ID = /^[A-Za-z0-9_-]{16,24}$/;

function parseCheckups(value: unknown): StoredCheckups {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.checkups))
    throw new Error("Invalid checkups.json; restore a valid backup.");
  for (const [id, item] of Object.entries(value.checkups)) {
    if (
      !isRecord(item) ||
      id !== item.id ||
      !CONTROL_ID.test(id) ||
      ![
        item.guildId,
        item.channelId,
        item.messageId,
        item.partnerRoleId,
        item.responseChannelId,
      ].every(isSnowflake) ||
      typeof item.period !== "string" ||
      !item.period.trim() ||
      item.period.length > 40 ||
      typeof item.createdAt !== "number" ||
      !Number.isFinite(item.createdAt) ||
      (item.closedAt !== null &&
        (typeof item.closedAt !== "number" ||
          !Number.isFinite(item.closedAt))) ||
      !isRecord(item.responses)
    )
      throw new Error("Invalid checkup record in checkups.json.");
    for (const [userId, response] of Object.entries(item.responses)) {
      if (
        !isSnowflake(userId) ||
        !isRecord(response) ||
        typeof response.nonce !== "string" ||
        !/^[a-f0-9]{24}$/.test(response.nonce) ||
        (response.messageId !== null && !isSnowflake(response.messageId))
      )
        throw new Error("Invalid checkup response record.");
    }
  }
  return value as unknown as StoredCheckups;
}

export class CheckupStore {
  readonly filePath: string;
  readonly #queue = new MutationQueue();
  #state: StoredCheckups = { version: 1, checkups: {} };
  constructor(dataDirectory: string) {
    this.filePath = join(dataDirectory, "checkups.json");
  }

  async initialize(): Promise<void> {
    const stored = await readStoredJson(this.filePath);
    const state = stored === undefined ? this.#state : parseCheckups(stored);
    await writeStoredJson(this.filePath, state);
    this.#state = state;
  }

  get(id: string): CheckupRecord | null {
    return structuredClone(this.#state.checkups[id] ?? null);
  }

  async create(record: CheckupRecord): Promise<CheckupRecord> {
    return this.#queue.run(async () => {
      const existing = this.#state.checkups[record.id];
      if (existing) return structuredClone(existing);
      const next = structuredClone(this.#state);
      // Keep storage bounded, retaining active checkups and 90 days of closed history.
      const cutoff = Date.now() - 90 * 86400_000;
      for (const [id, item] of Object.entries(next.checkups))
        if (item.closedAt !== null && item.closedAt < cutoff)
          delete next.checkups[id];
      if (Object.keys(next.checkups).length >= 5000)
        throw new Error(
          "Checkup storage is full. Archive old checkups before creating more.",
        );
      next.checkups[record.id] = structuredClone(record);
      parseCheckups(next);
      await this.#save(next);
      return structuredClone(record);
    });
  }

  async close(id: string): Promise<CheckupRecord | null> {
    return this.#queue.run(async () => {
      const next = structuredClone(this.#state);
      const record = next.checkups[id];
      if (!record) return null;
      record.closedAt ??= Date.now();
      await this.#save(next);
      return structuredClone(record);
    });
  }

  async submit(
    id: string,
    userId: string,
    deliver: (nonce: string) => Promise<string>,
  ): Promise<SubmissionResult> {
    return this.#queue.run(async () => {
      const current = this.#state.checkups[id];
      if (!current) return { status: "missing" };
      if (current.closedAt !== null) return { status: "closed" };
      if (current.responses[userId]?.messageId) return { status: "duplicate" };
      if (!isSnowflake(userId)) throw new Error("Invalid respondent ID.");
      const next = structuredClone(this.#state);
      const record = next.checkups[id]!;
      record.responses[userId] ??= {
        nonce: randomBytes(12).toString("hex"),
        messageId: null,
      };
      // Persist a retry nonce before sending, so immediate retries cannot double-post.
      await this.#save(next);
      const response = record.responses[userId]!;
      const messageId = await deliver(response.nonce);
      if (!isSnowflake(messageId))
        throw new Error("Invalid response message ID.");
      response.messageId = messageId;
      await this.#save(next);
      return { status: "submitted", messageId };
    });
  }

  async #save(next: StoredCheckups): Promise<void> {
    await writeStoredJson(this.filePath, next);
    this.#state = next;
  }
}
