import type { ActionResult } from "@/types/actions";

export type ActionFailure = Omit<Extract<ActionResult<unknown>, { success: false }>, "success"> & {
  success?: false;
};

/** Client-safe error preserving the detail of a refused action. */
export class ActionError extends Error {
  readonly code: ActionFailure["code"];
  readonly issues: NonNullable<ActionFailure["issues"]>;
  readonly conflict: ActionFailure["conflict"];
  readonly blockers?: ActionFailure["blockers"];
  readonly preview: ActionFailure["preview"];

  constructor(result: ActionFailure) {
    super(result.error);
    this.name = "ActionError";
    this.code = result.code;
    this.issues = result.issues ?? [];
    this.conflict = result.conflict;
    if (result.blockers) this.blockers = result.blockers;
    this.preview = result.preview;
  }
}

export function isActionError(error: unknown): error is ActionError {
  return error instanceof ActionError;
}
