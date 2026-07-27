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

  it("passes authoritative derived Removal editability to supporting sources", () => {
    const source = readFileSync(
      new URL("./removal-detail-sheet.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /<SourcesPanel\s+removalId=\{summary\.removalId\}\s+editable=\{derived\.isActionable\}/,
    );
  });
});
