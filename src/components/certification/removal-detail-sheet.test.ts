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
});
