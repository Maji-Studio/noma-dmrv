import type { ConflictRef } from "@/lib/conflict-ref";
import { DomainError, type DomainIssue } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";

/** Shared wording for "<Noun> was not deleted because ..." refusals. */
export const IN_USE_DELETE_MARKER = "was not deleted because";

/** Additive discriminator; the domain and issue codes remain `conflict`. */
export const IN_USE_REASON = "in_use";

export function inUseDeleteRefusal(
  message: string,
  path: DomainIssue["path"],
  meta?: DomainIssue["meta"],
  conflict?: ConflictRef,
): DomainError {
  const detail = new SafeError(message).message;
  return new DomainError("conflict", detail, {
    issues: [{ path, code: "conflict", message: detail, meta: { ...meta, reason: IN_USE_REASON } }],
    ...(conflict ? { conflict } : {}),
  });
}
