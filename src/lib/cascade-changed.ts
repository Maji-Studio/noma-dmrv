/**
 * The refusal a delete answers when the records it would remove changed since
 * the operator confirmed. It carries the fresh list, so the dialog can show it
 * and ask again instead of deleting something the operator never saw.
 *
 * Kept free of server-only imports so client components can use it.
 */

import type { CascadePreview } from "@/lib/domain-errors";

export class CascadeChangedError extends Error {
  readonly preview: CascadePreview;

  constructor(message: string, preview: CascadePreview) {
    super(message);
    this.name = "CascadeChangedError";
    this.preview = preview;
  }
}

/** Failure half of `ActionResult`, narrowed to what the cascade check needs. */
interface CascadeCarryingFailure {
  error: string;
  code?: string;
  preview?: unknown;
}

function isCascadePreview(value: unknown): value is CascadePreview {
  return typeof value === "object" && value !== null && "cascadeFingerprint" in value && "orders" in value;
}

/** Throw `CascadeChangedError` when the failure is a `cascade_changed` refusal with a fresh preview. */
export function throwIfCascadeChanged(result: CascadeCarryingFailure): void {
  if (result.code === "cascade_changed" && isCascadePreview(result.preview)) {
    throw new CascadeChangedError(result.error, result.preview);
  }
}
