import type { RemovalTemplateBlocker } from "./removal-template-blockers";

export class EmissionLinesBlockedError extends Error {
  constructor(readonly blocker: RemovalTemplateBlocker) {
    super(blocker.message);
    this.name = "EmissionLinesBlockedError";
  }
}

export function isEmissionLinesBlocked(error: unknown): error is EmissionLinesBlockedError {
  return error instanceof EmissionLinesBlockedError;
}
