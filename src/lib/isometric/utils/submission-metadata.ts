export function getMetadataValue(
  metadata: unknown,
  key: string,
): unknown {
  if (
    typeof metadata === "object" &&
    metadata !== null &&
    key in metadata
  ) {
    return (metadata as Record<string, unknown>)[key];
  }
  return null;
}
