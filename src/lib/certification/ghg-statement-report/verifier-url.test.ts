import { describe, expect, it } from "vitest";
import {
  buildVerifierReportUrl,
  capabilityTokenHashForReport,
  verifyReportCapabilityToken,
} from "./verifier-url";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";

describe("GHG Statement verifier capability URL", () => {
  it("builds a stable unguessable token and verifies it timing-safely", () => {
    const first = new URL(buildVerifierReportUrl(REPORT_ID));
    const second = new URL(buildVerifierReportUrl(REPORT_ID));
    const token = first.searchParams.get("token");

    expect(first.toString()).toBe(second.toString());
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(
      verifyReportCapabilityToken(
        REPORT_ID,
        token ?? "",
        capabilityTokenHashForReport(REPORT_ID),
      ),
    ).toBe(true);
    expect(
      verifyReportCapabilityToken(
        REPORT_ID,
        `${token}x`,
        capabilityTokenHashForReport(REPORT_ID),
      ),
    ).toBe(false);
  });
});
