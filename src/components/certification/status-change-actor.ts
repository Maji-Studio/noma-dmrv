/**
 * Who made a status change, as the status history line names it. Pure, so
 * the attribution copy is testable apart from the popover.
 */
import type { SubmissionStatusHistoryEntry } from "@/lib/certification/status-history";
import { MISSING_VALUE } from "@/lib/copy-utils";

type Source = NonNullable<SubmissionStatusHistoryEntry["source"]>;

const SOURCE_SUFFIX: Partial<Record<Source, string>> = {
  rest: "REST API",
  mcp: "MCP",
  registry: "registry update",
};

const ACTORLESS_SOURCE_LABEL: Partial<Record<Source, string>> = {
  registry: "Registry update",
  system: "System",
  script: "Script",
};

/** Who made a recorded change. Ledger entries predate recording: no one. */
export function describeStatusChangeActor(
  entry: Pick<SubmissionStatusHistoryEntry, "origin" | "source" | "actorName" | "actorUnavailable">,
): string | null {
  if (entry.origin === "ledger") return null;
  const suffix = entry.source ? SOURCE_SUFFIX[entry.source] : undefined;
  if (entry.actorName) {
    return suffix ? `${entry.actorName} (${suffix})` : entry.actorName;
  }
  // The user record is gone or carries no name.
  if (entry.actorUnavailable) return `Changed by: ${MISSING_VALUE.notAvailable}`;
  return (entry.source && ACTORLESS_SOURCE_LABEL[entry.source]) ?? null;
}
