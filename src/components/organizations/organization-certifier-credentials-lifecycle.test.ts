import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(
    process.cwd(),
    "src/components/organizations/organization-certifier-credentials.tsx",
  ),
  "utf8",
);

describe("OrganizationCertifierCredentials lifecycle", () => {
  it("keeps a rejected first-save verification visible when status becomes configured", () => {
    // The save mutation writes configured status into the query cache before
    // this local result renders. Keying the form by that status remounts it and
    // discards the result; a stable form instance preserves the rejected notice.
    expect(source).toContain("setVerification(result.verification)");
    expect(source).not.toMatch(/key=\{configured\s*\?/);
  });

  it("preserves typed input when a background status refetch fails", () => {
    // React Query retains the last successful data during a failed background
    // refetch. Continuing to render that data keeps the same unkeyed form (and
    // its uncontrolled input values) mounted; only a cold-load error replaces it.
    expect(source).toContain(
      "if (statusQuery.error && !statusQuery.data)",
    );
    expect(source).not.toMatch(/key=\{configured\s*\?/);
  });
});
