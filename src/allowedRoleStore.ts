import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STORE_VERSION = 1;
const STORE_FILENAME = "allowed-roles.json";
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

interface StoredAllowedRoles {
  readonly version: typeof STORE_VERSION;
  readonly guilds: Readonly<Record<string, readonly string[]>>;
}

export interface AllowedRoleSnapshot {
  readonly fallbackRoleIds: readonly string[];
  readonly persistentRoleIds: readonly string[];
  readonly allRoleIds: readonly string[];
}

export type AddAllowedRoleResult = "added" | "already-added" | "fallback";
export type RemoveAllowedRoleResult = "removed" | "not-found" | "fallback";

interface RoleIdLookup {
  has(roleId: string): boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function parseStore(content: string): Map<string, Set<string>> {
  const parsed: unknown = JSON.parse(content);

  if (!isRecord(parsed) || parsed.version !== STORE_VERSION || !isRecord(parsed.guilds)) {
    throw new Error("The allowed-role store has an unsupported or invalid structure.");
  }

  const guilds = new Map<string, Set<string>>();

  for (const [guildId, roleIds] of Object.entries(parsed.guilds)) {
    if (
      !SNOWFLAKE_PATTERN.test(guildId) ||
      !Array.isArray(roleIds) ||
      roleIds.some(
        (roleId: unknown) =>
          typeof roleId !== "string" || !SNOWFLAKE_PATTERN.test(roleId),
      )
    ) {
      throw new Error("The allowed-role store contains an invalid Discord ID.");
    }

    guilds.set(guildId, new Set(roleIds as string[]));
  }

  return guilds;
}

function serializeStore(guilds: ReadonlyMap<string, ReadonlySet<string>>): string {
  const storedGuilds: Record<string, readonly string[]> = {};

  for (const [guildId, roleIds] of [...guilds.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    storedGuilds[guildId] = [...roleIds].sort();
  }

  const store: StoredAllowedRoles = {
    version: STORE_VERSION,
    guilds: storedGuilds,
  };

  return `${JSON.stringify(store, null, 2)}\n`;
}

function cloneGuilds(
  guilds: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Set<string>> {
  return new Map(
    [...guilds].map(([guildId, roleIds]) => [guildId, new Set(roleIds)]),
  );
}

export class AllowedRoleStore {
  readonly #dataDirectory: string;
  readonly #filePath: string;
  readonly #fallbackRoleIds: readonly string[];
  #persistentRoles = new Map<string, Set<string>>();
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(dataDirectory: string, fallbackRoleIds: readonly string[]) {
    this.#dataDirectory = dataDirectory;
    this.#filePath = join(dataDirectory, STORE_FILENAME);
    this.#fallbackRoleIds = Object.freeze([...new Set(fallbackRoleIds)]);
  }

  get filePath(): string {
    return this.#filePath;
  }

  async initialize(): Promise<void> {
    await mkdir(this.#dataDirectory, { recursive: true });

    let content: string;

    try {
      content = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      await this.#persist(new Map());
      return;
    }

    try {
      this.#persistentRoles = parseStore(content);
    } catch (error) {
      const backupPath = `${this.#filePath}.corrupt-${Date.now()}`;
      await rename(this.#filePath, backupPath);
      console.error(
        `Invalid allowed-role store moved to ${backupPath}; using fallback roles only.`,
        error,
      );
      await this.#persist(new Map());
    }
  }

  getSnapshot(guildId: string): AllowedRoleSnapshot {
    const persistentRoleIds = Object.freeze([
      ...(this.#persistentRoles.get(guildId) ?? new Set<string>()),
    ].sort());
    const allRoleIds = Object.freeze([
      ...new Set([...this.#fallbackRoleIds, ...persistentRoleIds]),
    ]);

    return Object.freeze({
      fallbackRoleIds: this.#fallbackRoleIds,
      persistentRoleIds,
      allRoleIds,
    });
  }

  hasAllowedRole(guildId: string, memberRoleIds: RoleIdLookup): boolean {
    return this.getSnapshot(guildId).allRoleIds.some((roleId) =>
      memberRoleIds.has(roleId),
    );
  }

  hasFallbackRole(memberRoleIds: RoleIdLookup): boolean {
    return this.#fallbackRoleIds.some((roleId) => memberRoleIds.has(roleId));
  }

  async addPersistentRole(
    guildId: string,
    roleId: string,
  ): Promise<AddAllowedRoleResult> {
    return this.#enqueueMutation(async () => {
      if (this.#fallbackRoleIds.includes(roleId)) {
        return "fallback";
      }

      if (this.#persistentRoles.get(guildId)?.has(roleId)) {
        return "already-added";
      }

      const nextGuilds = cloneGuilds(this.#persistentRoles);
      const nextRoleIds = nextGuilds.get(guildId) ?? new Set<string>();
      nextRoleIds.add(roleId);
      nextGuilds.set(guildId, nextRoleIds);
      await this.#persist(nextGuilds);
      return "added";
    });
  }

  async removePersistentRole(
    guildId: string,
    roleId: string,
  ): Promise<RemoveAllowedRoleResult> {
    return this.#enqueueMutation(async () => {
      if (this.#fallbackRoleIds.includes(roleId)) {
        return "fallback";
      }

      if (!this.#persistentRoles.get(guildId)?.has(roleId)) {
        return "not-found";
      }

      const nextGuilds = cloneGuilds(this.#persistentRoles);
      const nextRoleIds = nextGuilds.get(guildId);
      nextRoleIds?.delete(roleId);

      if (nextRoleIds?.size === 0) {
        nextGuilds.delete(guildId);
      }

      await this.#persist(nextGuilds);
      return "removed";
    });
  }

  #enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(operation, operation);
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #persist(nextGuilds: Map<string, Set<string>>): Promise<void> {
    const temporaryPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, serializeStore(nextGuilds), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, this.#filePath);
    this.#persistentRoles = nextGuilds;
  }
}
