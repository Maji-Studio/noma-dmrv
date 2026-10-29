import { isActionError } from "@/lib/action-error";
import type { ConflictRef } from "@/lib/conflict-ref";
import { DomainError, type DomainIssue } from "@/lib/domain-errors";
import { SafeError } from "@/lib/errors";

/** Shared wording only for "<Noun> was not deleted because ...", not refusal detection. */
export const IN_USE_DELETE_MARKER = "was not deleted because";

/** Additive discriminator: the domain and issue codes stay as they were (`conflict`, or `certification_locked` where that was already the contract). */
export const IN_USE_REASON = "in_use";

/** Codes are already capped; the total includes unnamed blockers. */
export function deleteRefusalList(codes: readonly string[], totalCount = codes.length): string {
  const names = [...codes];
  const remaining = Math.max(totalCount, codes.length) - names.length;
  if (remaining > 0) names.push(`${remaining} more`);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "";
}

export function inUseDeleteRefusal(
  message: string,
  path: DomainIssue["path"],
  { meta, conflict, code = "conflict" }: { meta?: DomainIssue["meta"]; conflict?: ConflictRef; code?: "conflict" | "certification_locked" } = {},
): DomainError {
  const detail = new SafeError(message).message;
  return new DomainError(code, detail, {
    issues: [{ path, code, message: detail, meta: { ...meta, reason: IN_USE_REASON } }],
    ...(conflict ? { conflict } : {}),
  });
}

/** True when the action carries an "in use" delete refusal issue, under `conflict` or `certification_locked`. */
export function isInUseDeleteRefusal(error: unknown): boolean {
  return isActionError(error) && (error.code === "conflict" || error.code === "certification_locked")
    && error.issues.some((issue) => issue.meta?.reason === IN_USE_REASON);
}
