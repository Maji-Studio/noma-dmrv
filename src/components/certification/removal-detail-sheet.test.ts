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

  it("shows submitted-state advisories without the submission availability note", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "<AdvisoryRows advisories={advisories} showSubmissionNote={false} />",
    );
    expect(source).toContain("showSubmissionNote = true");
    expect(source).toContain(
      "Advisory — {advisory}. Submission remains available.",
    );
  });

  it("keeps a failed-enrichment row inspectable with retry and Source repair routes", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Readiness unavailable for this Removal.");
    expect(source).toContain("Retry readiness");
    expect(source).toContain("<SourcesPanel");
    expect(source).toContain("removalId={summary.removalId}");
  });

  it("renders post-submit attachment health separately from files ready", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('<Field label="Evidence attachments">');
    expect(source).toContain("summary.evidenceHealth.label");
    expect(source).toContain(
      "<SourcesPanel removalId={summary.removalId} />",
    );
  });
});
