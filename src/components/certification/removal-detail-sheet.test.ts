import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("RemovalDetailSheet sync history contract", () => {
  it("mounts the compact SyncEventLog with removal-scoped summary events", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('import { SyncEventLog } from "./sync-event-log"');
    expect(source).toMatch(
      /<SyncEventLog\s+events=\{summary\.recentSyncEvents\}\s+compact/,
    );
  });

  it("uses the centralized workflow status instead of separate lifecycle and readiness blocks", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("deriveRemovalWorkflowStatus");
    expect(source).toContain("Submission status");
    expect(source).not.toContain("ReadinessBlock");
    expect(source).not.toContain("all preconditions met");
  });

  it("keeps a failed-enrichment row inspectable with retry and Source repair routes", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("status.canRetry");
    expect(source).toMatch(/<Button[\s\S]*?>\s*Retry\s*<\/Button>/);
    expect(source).toMatch(
      /<SourcesPanel[\s\S]*?removalId=\{summary\.removalId\}[\s\S]*?\/>/,
    );
  });

  it("does not show a registry-result placeholder before the first submission", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /\{summary\.externalId && \(\s*<RemovalCarbonBreakdown/,
    );
  });

  it("omits empty submission history", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("summary.recentSyncEvents.length > 0");
    expect(source).toContain("Submission history");
  });

  it("renders post-submit attachment health separately from files ready", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('<Field label="Evidence attachments">');
    expect(source).toContain("summary.evidenceHealth.label");
    expect(source).toContain(
      "<SourcesPanel",
    );
  });

  it("reads the facility project mapping for the storage sites field", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("useFacilityCertifierSummary");
    expect(source).toMatch(
      /certifierSummary\?\.mapping\?\.externalProjectId\s*\?\?\s*null/,
    );
    expect(source).toContain("<RemovalStorageSitesField");
  });
});
