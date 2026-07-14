/**
 * Log sanitization primitives, deliberately free of any `@/config/env` import.
 * The CLI bootstrap (`ensure-admin`) runs before the app env schema is
 * satisfiable, so it needs the sanitizer without pulling the logger — which
 * validates the full env at module load. Re-exported from `../log`.
 */

export const REDACTED = "[REDACTED]";

/** Default cap for sanitized error-message fields. */
const ERROR_MESSAGE_MAX_LENGTH = 200;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Drizzle's DrizzleQueryError message embeds every bound value after a
// `params:` marker (`Failed query: <sql>\nparams: <values>`; some drivers
// inline it as `-- params: [...]`). Bound values are arbitrary user data —
// names, phone numbers, addresses — so the whole section is redacted, not just
// email-shaped text. The parameterized SQL before the marker contains only
// placeholders ($1, $2) and is kept for debuggability. Deliberately broad: a
// non-query message containing `params:` gets over-redacted, which is the
// right failure mode for a log sanitizer.
const QUERY_PARAMS_PATTERN = /(?:--\s*)?\bparams:[\s\S]*$/;

/**
 * Turn an arbitrary error (or message string) into a log-safe value: extract
 * its message, redact the bound-params section of driver/query errors, strip
 * email-shaped PII (the logger's key-based `redact` cannot reach free-text
 * inside a message), and truncate so a verbose driver/stack message can't
 * bloat a log line. Pass the result as a structured field, not raw error.
 */
export function sanitizeErrorMessage(
  messageOrError: unknown,
  maxLength = ERROR_MESSAGE_MAX_LENGTH,
): string {
  const raw =
    messageOrError instanceof Error
      ? messageOrError.message
      : typeof messageOrError === "string"
        ? messageOrError
        : String(messageOrError);
  const scrubbed = raw
    .replace(QUERY_PARAMS_PATTERN, `params: ${REDACTED}`)
    .replace(EMAIL_PATTERN, REDACTED);
  return scrubbed.length > maxLength
    ? `${scrubbed.slice(0, maxLength)}…`
    : scrubbed;
}
