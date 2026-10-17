import { PermissionFlagsBits, type GuildMember } from "discord.js";
import type { AllowedRoleStore } from "./allowedRoleStore.js";

export function canManageBot(
  member: GuildMember,
  store: AllowedRoleStore,
): boolean {
  return (
    member.id === member.guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    store.hasManager(member.guild.id, member.id, member.roles.cache)
  );
}

export function canOperateBot(
  member: GuildMember,
  store: AllowedRoleStore,
): boolean {
  return (
    canManageBot(member, store) ||
    store.hasAccess(member.guild.id, member.id, member.roles.cache)
  );
}
