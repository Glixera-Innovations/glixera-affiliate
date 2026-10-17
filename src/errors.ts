/** Keep credentials out of diagnostic messages, including API errors. */
export function describeError(
  error: unknown,
  secrets: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  let message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  for (const secret of secrets)
    if (secret) message = message.replaceAll(secret, "[redacted]");
  return { name: error instanceof Error ? error.name : typeof error, message };
}
