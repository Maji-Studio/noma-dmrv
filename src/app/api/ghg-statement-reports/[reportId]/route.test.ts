import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/data-access/ghg-statement-reports", () => ({
  getVerifierReportDocument: vi.fn(),
}));
vi.mock(
  "@/lib/certification/ghg-statement-report/verifier-url",
  () => ({
    verifyReportCapabilityTokenAgainstHashes: vi.fn(),
  }),
);
vi.mock("@/lib/storage", () => ({
  getStorageProvider: vi.fn(),
}));

import { getVerifierReportDocument } from "@/data-access/ghg-statement-reports";
import { verifyReportCapabilityTokenAgainstHashes } from "@/lib/certification/ghg-statement-report/verifier-url";
import { getStorageProvider } from "@/lib/storage";
import { GET } from "./route";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const context = {
  params: Promise.resolve({ reportId: REPORT_ID }),
};

describe("GHG Statement verifier report route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getVerifierReportDocument).mockResolvedValue({
      documentId: "22222222-2222-4222-8222-222222222222",
      storageKey: "org/org-1/ghg-statement-reports/report.pdf",
      uploadStatus: "uploaded",
      verifierTokenHash: "a".repeat(64),
      pendingVerifierTokenHash: "b".repeat(64),
    });
  });

  it("returns 404 without a valid capability token", async () => {
    vi.mocked(verifyReportCapabilityTokenAgainstHashes).mockReturnValue(false);

    const response = await GET(
      new NextRequest(
        `https://app.example/api/ghg-statement-reports/${REPORT_ID}`,
      ),
      context,
    );

    expect(response.status).toBe(404);
    expect(getStorageProvider).not.toHaveBeenCalled();
  });

  it("redirects a valid capability to a fresh private-storage URL", async () => {
    vi.mocked(verifyReportCapabilityTokenAgainstHashes).mockReturnValue(true);
    const createDownloadUrl = vi
      .fn()
      .mockResolvedValue("https://storage.example/signed-report.pdf");
    vi.mocked(getStorageProvider).mockReturnValue({
      createDownloadUrl,
    } as unknown as ReturnType<typeof getStorageProvider>);

    const response = await GET(
      new NextRequest(
        `https://app.example/api/ghg-statement-reports/${REPORT_ID}?token=opaque`,
      ),
      context,
    );

    expect(response.status).toBe(302);
    // The token is checked against the stored digest alone; the report is
    // identified by the row the digest came from, not by a derived value.
    expect(verifyReportCapabilityTokenAgainstHashes).toHaveBeenCalledWith(
      "opaque",
      ["a".repeat(64), "b".repeat(64)],
    );
    expect(response.headers.get("location")).toBe(
      "https://storage.example/signed-report.pdf",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(createDownloadUrl).toHaveBeenCalledWith({
      key: "org/org-1/ghg-statement-reports/report.pdf",
    });
  });
});
