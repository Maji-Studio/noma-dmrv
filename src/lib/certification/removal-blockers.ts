import type { BatchHealthFixTarget } from "./batch-health";
import { removalTemplateBlocker, removalTemplateBlockerDestination, type RemovalTemplateBlockerCode } from "./removal-template-blockers";

export type RemovalBlockerCode = RemovalTemplateBlockerCode | "lineNeedsReview" | "lineNeedsSetup" | "entryMissingEvidence" | "lineHasNoSource" | "feedstockTypeMapping" | "entityReadiness" | "durabilityTier" | "durabilityConfiguration" | "legacy";
export interface RemovalBlocker {
  code: RemovalBlockerCode;
  message: string;
  fixTarget: BatchHealthFixTarget | null;
  lineRef?: { componentId: string; displayName: string; inputKey?: string };
}
export interface RemovalAdvisory extends Omit<RemovalBlocker, "code"> {
  code: RemovalBlockerCode | "droppedRecordedFact";
}
export function legacyBlocker(message: string, fixTarget: BatchHealthFixTarget | null = null): RemovalBlocker {
  return { code: "legacy", message, fixTarget };
}
export function templateRemovalBlocker(code: RemovalTemplateBlockerCode): RemovalBlocker {
  return { ...removalTemplateBlocker(code), fixTarget: removalTemplateBlockerDestination(code) };
}
