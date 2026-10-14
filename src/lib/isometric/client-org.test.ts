import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(),
  env: { ISOMETRIC_ENVIRONMENT: "sandbox" },
}));
vi.mock("@/config/env", () => ({ env: mocks.env }));
vi.mock("@/data-access/certifier-credentials", () => ({
  getDecryptedCertifierCredentials: mocks.credentials,
}));
import { getIsometricClientForOrg } from "./client";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("existing organization credential factory", () => {
  it.each(["sandbox", "production"])("uses organization credentials with the %s URL", async (environment) => {
    mocks.env.ISOMETRIC_ENVIRONMENT = environment;
    mocks.credentials.mockResolvedValue({ clientSecret: "org-secret", accessToken: "org-token" });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const client = await getIsometricClientForOrg("org-test");
    await client.get("/projects");
    expect(mocks.credentials).toHaveBeenCalledWith("org-test", "isometric");
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.${environment === "sandbox" ? "sandbox." : ""}isometric.com/mrv/v0/projects`,
      expect.objectContaining({ headers: {
        Accept: "application/json",
        "X-Client-Secret": "org-secret",
        Authorization: "Bearer org-token",
      } }),
    );
  });

  it("preserves not_configured when the organization has no credentials", async () => {
    mocks.credentials.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = await getIsometricClientForOrg("org-unconfigured");
    await expect(client.get("/projects")).rejects.toMatchObject({ code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
