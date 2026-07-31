/**
 * Errors that are safe to expose to clients verbatim.
 * Use this for intentional, user-facing validation/business rule errors.
 * Unexpected errors (DB failures, network errors, etc.) should use plain Error
 * so withAction can suppress their messages in production.
 */
export class SafeError extends Error {
  constructor(message: string) {
    super(formatSafeErrorMessage(message));
    this.name = "SafeError";
  }
}

/**
 * Normalize terse missing-record errors from shared data access without
 * exposing internal IDs. Call sites may still provide a tailored recovery
 * action when the operator can do something specific.
 */
function formatSafeErrorMessage(message: string): string {
  const trimmed = message.trim();

  const missingInOrganization =
    /^(.+?) not found in this organization\.?$/i.exec(trimmed);
  if (missingInOrganization) {
    return `${sentenceCase(missingInOrganization[1])} was not found in this Organization.`;
  }

  const missingOrArchived = /^(.+?) not found or archived\.?$/i.exec(trimmed);
  if (missingOrArchived) {
    return `${sentenceCase(missingOrArchived[1])} was not found or is archived.`;
  }

  const missingForRecord = /^(.+?) not found for (.+?)\.?$/i.exec(trimmed);
  if (missingForRecord) {
    return `${sentenceCase(missingForRecord[1])} was not found for ${missingForRecord[2]}.`;
  }

  const missingWithInternalId = /^(.+?) not found:\s*.+$/i.exec(trimmed);
  if (missingWithInternalId) {
    return `${sentenceCase(missingWithInternalId[1])} was not found.`;
  }

  const missing = /^(.+?) not found\.?$/i.exec(trimmed);
  if (missing) {
    return missingRecordMessage(missing[1]);
  }

  return message;
}

export class ActionConflictError extends SafeError {
  readonly conflict: { entity: string; id: string; code: string };

  constructor(
    message: string,
    conflict: { entity: string; id: string; code: string },
  ) {
    super(message);
    this.name = "ActionConflictError";
    this.conflict = conflict;
  }
}

const FALLBACK_RECOVERY = {
  load: "Refresh the page and try again.",
  retry: "Try again.",
} as const;

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function missingRecordMessage(entity: string): string {
  return `${sentenceCase(entity)} was not found.`;
}

function pluralAgreement(subject: string): "was" | "were" {
  const finalWord = subject.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
  return finalWord.endsWith("s") &&
    !/(?:address|mass|process|status)$/.test(finalWord)
    ? "were"
    : "was";
}

/**
 * Turn terse developer fallbacks into specific, actionable user messages.
 *
 * Intentional SafeError messages do not pass through this function.
 */
export function formatActionFallback(fallbackMessage: string): string {
  const message = fallbackMessage.trim().replace(/\.$/, "");
  const failedMatch = /^Failed to ([a-z]+) (.+)$/i.exec(message);
  if (!failedMatch) return fallbackMessage;

  const [, action, rawSubject] = failedMatch;
  const subject = sentenceCase(rawSubject);
  const agreement = pluralAgreement(subject);

  switch (action.toLowerCase()) {
    case "get":
    case "load":
    case "fetch":
      return `${subject} could not be loaded. ${FALLBACK_RECOVERY.load}`;
    case "create":
      return `${subject} ${agreement} not created. ${FALLBACK_RECOVERY.retry}`;
    case "update":
    case "save":
      return `${subject} ${agreement} not saved. ${FALLBACK_RECOVERY.retry}`;
    case "delete":
      return `${subject} ${agreement} not deleted. ${FALLBACK_RECOVERY.retry}`;
    case "archive":
      return `${subject} ${agreement} not archived. ${FALLBACK_RECOVERY.retry}`;
    case "restore":
    case "unarchive":
      return `${subject} ${agreement} not restored. ${FALLBACK_RECOVERY.retry}`;
    case "check":
      return `${subject} could not be checked. ${FALLBACK_RECOVERY.retry}`;
    case "search":
      return `${subject} could not be searched. ${FALLBACK_RECOVERY.retry}`;
    case "generate":
      return `${subject} could not be generated. ${FALLBACK_RECOVERY.retry}`;
    case "record":
      return `${subject} ${agreement} not recorded. ${FALLBACK_RECOVERY.retry}`;
    case "send":
      return `${subject} ${agreement} not sent. ${FALLBACK_RECOVERY.retry}`;
    case "revoke":
      return `${subject} ${agreement} not revoked. ${FALLBACK_RECOVERY.retry}`;
    case "remove":
      return `${subject} ${agreement} not removed. ${FALLBACK_RECOVERY.retry}`;
    case "switch":
      return `${subject} ${agreement} not switched. ${FALLBACK_RECOVERY.retry}`;
    case "accept":
      return `${subject} ${agreement} not accepted. ${FALLBACK_RECOVERY.retry}`;
    case "import":
      return `${subject} ${agreement} not imported. ${FALLBACK_RECOVERY.retry}`;
    case "parse":
    case "read":
      return `${subject} could not be read. ${FALLBACK_RECOVERY.retry}`;
    default:
      return `The action to ${action.toLowerCase()} ${rawSubject} could not be completed. ${FALLBACK_RECOVERY.retry}`;
  }
}

/**
 * Convert an arbitrary server-side error into a client-safe action message.
 * Only intentional SafeError messages cross the server/client boundary.
 */
export function toActionError(
  error: unknown,
  fallbackMessage: string,
): string {
  if (error instanceof SafeError) return error.message;
  return formatActionFallback(fallbackMessage);
}
