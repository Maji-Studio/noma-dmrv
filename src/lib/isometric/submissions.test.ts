import { afterEach, describe, expect, it, vi } from "vitest";

// Credentials + environment for the client boundary. The real env is
// Zod-validated and may lack Isometric creds in unit runs, so stub just the
// fields `client.ts` reads (clientSecret / accessToken / environment).
vi.mock("@/config/env", () => ({
  env: {
    ISOMETRIC_CLIENT_SECRET: "test-client-secret",
    ISOMETRIC_ACCESS_TOKEN: "test-access-token",
    ISOMETRIC_ENVIRONMENT: "sandbox",
  },
}));
vi.mock("@/data-access/certifier-credentials", () => ({
  getDecryptedCertifierCredentials: vi.fn().mockResolvedValue(null),
}));

import {
  getIsometricClientForOrg,
  getIsometricClientFromEnv,
} from "./client";
import { findGhgEntryBySupplierRef } from "./submissions";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function stubPaginatedFetch(nodes: Array<{ id: string }>) {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () =>
      JSON.stringify({
        nodes,
        page_info: { has_next_page: false, end_cursor: null },
        total_count: nodes.length,
      }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("findGhgEntryBySupplierRef — wire contract (post-2026-06-04 rename)", () => {
  // Drift guard: the supplier-ref recovery lookup must hit the renamed
  // /ghg_entries route (not the deprecated /removals) with the
  // supplier_reference_id query param. Old Removals resolve through this
  // route because they are the same resources under the rename.
  it("GETs /ghg_entries with the supplier_reference_id query param", async () => {
    const fetchMock = stubPaginatedFetch([{ id: "rmv_known_1" }]);

    const result = await findGhgEntryBySupplierRef(
      getIsometricClientFromEnv(),
      "nm-rmv-abc-removal-v1",
    );

    expect(result).toEqual({ id: "rmv_known_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string },
    ];
    const url = new URL(requestUrl);
    expect(requestInit.method).toBe("GET");
    expect(url.pathname).toBe("/mrv/v0/ghg_entries");
    expect(url.pathname).not.toContain("/removals");
    expect(url.searchParams.get("supplier_reference_id")).toBe(
      "nm-rmv-abc-removal-v1",
    );
  });

  it("returns null when no GHG entry matches the supplier reference", async () => {
    stubPaginatedFetch([]);

    const result = await findGhgEntryBySupplierRef(
      getIsometricClientFromEnv(),
      "nm-rmv-missing-removal-v1",
    );

    expect(result).toBeNull();
  });
});

describe("getIsometricClientForOrg", () => {
  it("preserves not_configured degradation when the organization has no credentials", async () => {
    const client = await getIsometricClientForOrg("org-unconfigured");

    await expect(client.get("/projects")).rejects.toMatchObject({
      code: "not_configured",
    });
  });
});
