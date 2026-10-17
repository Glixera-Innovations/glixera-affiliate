import { join } from "node:path";
import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import {
  isRecord,
  isSnowflake,
  MutationQueue,
  readStoredJson,
  writeStoredJson,
} from "./storage.js";

export type AccessLevel = "operator" | "manager";
export type AccessSubject = "role" | "user";

interface GuildSettings {
  roleIds: string[];
  managerRoleIds: string[];
  userIds: string[];
  managerUserIds: string[];
  logChannelId: string | null;
  legacyImported: boolean;
}

interface StoredSettings {
  version: 2;
  guilds: Record<string, GuildSettings>;
}

export interface AllowedRoleSnapshot extends Readonly<GuildSettings> {
  readonly allRoleIds: readonly string[];
}

interface RoleLookup {
  has(roleId: string): boolean;
}
const MAX_ACCESS_ENTRIES = 100;
const emptySettings = (): GuildSettings => ({
  roleIds: [],
  managerRoleIds: [],
  userIds: [],
  managerUserIds: [],
  logChannelId: null,
  legacyImported: false,
});

function readIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => !isSnowflake(id))) {
    throw new Error("Invalid Discord IDs in allowed-roles.json.");
  }
  return [...new Set(value as string[])].sort();
}

function parseSettings(value: unknown): StoredSettings {
  if (
    !isRecord(value) ||
    !isRecord(value.guilds) ||
    (value.version !== 1 && value.version !== 2)
  ) {
    throw new Error(
      "Unsupported allowed-role configuration. Restore a valid backup.",
    );
  }
  const guilds: Record<string, GuildSettings> = {};
  for (const [guildId, settings] of Object.entries(value.guilds)) {
    if (!isSnowflake(guildId))
      throw new Error("Invalid server ID in allowed-role configuration.");
    if (value.version === 1) {
      guilds[guildId] = { ...emptySettings(), roleIds: readIds(settings) };
      continue;
    }
    if (
      !isRecord(settings) ||
      typeof settings.legacyImported !== "boolean" ||
      (settings.logChannelId !== null && !isSnowflake(settings.logChannelId))
    ) {
      throw new Error("Invalid server settings in allowed-roles.json.");
    }
    guilds[guildId] = {
      roleIds: readIds(settings.roleIds),
      managerRoleIds: readIds(settings.managerRoleIds),
      userIds: readIds(settings.userIds),
      managerUserIds: readIds(settings.managerUserIds),
      logChannelId: settings.logChannelId,
      legacyImported: settings.legacyImported,
    };
  }
  return { version: 2, guilds };
}

/** Persistent per-server permissions and logging. The filename preserves 0.2.x data. */
export class AllowedRoleStore {
  readonly filePath: string;
  readonly #legacyRoleIds: readonly string[];
  readonly #queue = new MutationQueue();
  #state: StoredSettings = { version: 2, guilds: {} };

  constructor(dataDirectory: string, legacyRoleIds: readonly string[] = []) {
    this.filePath = join(dataDirectory, "allowed-roles.json");
    this.#legacyRoleIds = legacyRoleIds;
  }

  async initialize(guildIds: readonly string[] = []): Promise<void> {
    const stored = await readStoredJson(this.filePath);
    const state = stored === undefined ? this.#state : parseSettings(stored);
    if (isRecord(stored) && stored.version === 1) {
      try {
        await copyFile(
          this.filePath,
          `${this.filePath}.v1.bak`,
          constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if (!isRecord(error) || error.code !== "EEXIST") throw error;
      }
    }
    for (const guildId of guildIds) {
      if (!isSnowflake(guildId))
        throw new Error("Invalid configured server ID.");
      const settings = state.guilds[guildId] ?? emptySettings();
      if (!settings.legacyImported) {
        settings.managerRoleIds = [
          ...new Set([
            ...settings.managerRoleIds,
            ...readIds([...this.#legacyRoleIds]).filter((id) => id !== guildId),
          ]),
        ].sort();
        settings.roleIds = settings.roleIds.filter(
          (id) => !settings.managerRoleIds.includes(id),
        );
        settings.legacyImported = true;
      }
      state.guilds[guildId] = settings;
    }
    await writeStoredJson(this.filePath, state);
    this.#state = state;
  }

  getSnapshot(guildId: string): AllowedRoleSnapshot {
    const settings = structuredClone(
      this.#state.guilds[guildId] ?? emptySettings(),
    );
    return {
      ...settings,
      allRoleIds: [
        ...new Set([...settings.roleIds, ...settings.managerRoleIds]),
      ],
    };
  }

  hasManager(guildId: string, userId: string, roles: RoleLookup): boolean {
    const settings = this.getSnapshot(guildId);
    return (
      settings.managerUserIds.includes(userId) ||
      settings.managerRoleIds.some((id) => roles.has(id))
    );
  }

  hasAccess(guildId: string, userId: string, roles: RoleLookup): boolean {
    const settings = this.getSnapshot(guildId);
    return (
      this.hasManager(guildId, userId, roles) ||
      settings.userIds.includes(userId) ||
      settings.roleIds.some((id) => roles.has(id))
    );
  }

  async setAccess(
    guildId: string,
    subject: AccessSubject,
    id: string,
    level: AccessLevel,
  ): Promise<boolean> {
    if (!isSnowflake(id)) throw new Error("Invalid access ID.");
    if (subject === "role" && id === guildId)
      throw new Error("Everyone cannot receive bot access.");
    return this.#mutate(guildId, (settings) => {
      const operatorKey = subject === "role" ? "roleIds" : "userIds";
      const managerKey =
        subject === "role" ? "managerRoleIds" : "managerUserIds";
      const key = level === "manager" ? managerKey : operatorKey;
      const otherKey = level === "manager" ? operatorKey : managerKey;
      if (settings[key].includes(id) && !settings[otherKey].includes(id))
        return false;
      if (settings[key].length >= MAX_ACCESS_ENTRIES)
        throw new Error("The access list is full (100 entries per list).");
      settings[otherKey] = settings[otherKey].filter((entry) => entry !== id);
      settings[key] = [...new Set([...settings[key], id])].sort();
      return true;
    });
  }

  async removeAccess(
    guildId: string,
    subject: AccessSubject,
    id: string,
  ): Promise<boolean> {
    return this.#mutate(guildId, (settings) => {
      const keys =
        subject === "role"
          ? (["roleIds", "managerRoleIds"] as const)
          : (["userIds", "managerUserIds"] as const);
      const existed = keys.some((key) => settings[key].includes(id));
      for (const key of keys)
        settings[key] = settings[key].filter((entry) => entry !== id);
      return existed;
    });
  }

  async setLogChannel(
    guildId: string,
    channelId: string | null,
  ): Promise<void> {
    if (channelId !== null && !isSnowflake(channelId))
      throw new Error("Invalid log channel ID.");
    await this.#mutate(guildId, (settings) => {
      settings.logChannelId = channelId;
    });
  }

  #mutate<T>(
    guildId: string,
    operation: (settings: GuildSettings) => T,
  ): Promise<T> {
    if (!isSnowflake(guildId))
      return Promise.reject(new Error("Invalid server ID."));
    return this.#queue.run(async () => {
      const next = structuredClone(this.#state);
      const settings = next.guilds[guildId] ?? emptySettings();
      const result = operation(settings);
      next.guilds[guildId] = settings;
      await writeStoredJson(this.filePath, next);
      this.#state = next;
      return result;
    });
  }
}
