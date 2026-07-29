const REDACTED_CAPABILITY = "[redacted]";

export function redactReportUrlSecrets(
  value: string | null,
): string | null {
  if (!value || !URL.canParse(value)) return value;
  const url = new URL(value);
  if (url.searchParams.has("token")) {
    url.searchParams.set("token", REDACTED_CAPABILITY);
  }
  return url.toString();
}

export function redactReportSecrets(value: unknown): unknown {
  if (typeof value === "string") {
    return redactReportUrlSecrets(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactReportSecrets);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      redactReportSecrets(child),
    ]),
  );
}
