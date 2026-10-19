import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RemovalListRow } from "./removal-list-state";
import { StatusCell } from "./removals-list";

vi.mock("@/lib/certification/status", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/certification/status")>(),
  deriveRemovalWorkflowStatus: ({ readiness }: RemovalListRow) => ({
    value: "blocked", label: "Blocked", reasons: readiness?.reasons ?? [], canRetry: false,
  }),
}));

describe("Removal list reason", () => {
  it.each(["Template blocked.", "Template blocked.\nRename a component.\nReview settings."])(
    "shows only the lead of %s and retains the additional reason count", (reason) => {
      const summary = { readiness: { reasons: [reason, "Other blocker."] } } as RemovalListRow;
      const html = renderToStaticMarkup(<StatusCell summary={summary} />);
      expect(html).toContain("Template blocked. +1 more");
      expect(html).not.toContain("Rename a component.");
      expect(html).not.toContain("Review settings.");
    },
  );
});
