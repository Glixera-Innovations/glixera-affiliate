function getDiscordErrorCode(error: unknown): string | number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const { code } = error as { readonly code?: unknown };
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

export function isDiscordMissingAccessError(error: unknown): boolean {
  const code = getDiscordErrorCode(error);
  return code === 50_001 || code === "50001";
}
