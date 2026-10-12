const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The same JSON value with every UUID string in uppercase, as a client may
 * send it: the published `uuid` format accepts either case (`api/uuid-case`).
 */
export function uppercaseUuids<T>(value: T): T {
  if (typeof value === "string") return (UUID_PATTERN.test(value) ? value.toUpperCase() : value) as T;
  if (Array.isArray(value)) return value.map(uppercaseUuids) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, uppercaseUuids(nested)])) as T;
  }
  return value;
}
