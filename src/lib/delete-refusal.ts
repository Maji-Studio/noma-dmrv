import { isActionError } from "@/lib/action-error";
import type { ConflictRef } from "@/lib/conflict-ref";
import { DomainError, type DomainIssue } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";

/** Shared wording only for "<Noun> was not deleted because ...", not refusal detection. */
export const IN_USE_DELETE_MARKER = "was not deleted because";

/** Additive discriminator; the domain and issue codes remain `conflict`. */
export const IN_USE_REASON = "in_use";

export function inUseDeleteRefusal(
  message: string,
  path: DomainIssue["path"],
  { meta, conflict }: { meta?: DomainIssue["meta"]; conflict?: ConflictRef } = {},
): DomainError {
  const detail = new SafeError(message).message;
  return new DomainError("conflict", detail, {
    issues: [{ path, code: "conflict", message: detail, meta: { ...meta, reason: IN_USE_REASON } }],
    ...(conflict ? { conflict } : {}),
  });
}

/** True when the action carries a conflict with an "in use" delete refusal issue. */
export function isInUseDeleteRefusal(error: unknown): boolean {
  return isActionError(error) && error.code === "conflict"
    && error.issues.some((issue) => issue.meta?.reason === IN_USE_REASON);
}
