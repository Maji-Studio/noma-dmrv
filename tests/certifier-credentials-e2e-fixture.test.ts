import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({
  logger: { child: () => ({ debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { createIsometricClient, IsometricApiError } from "@/lib/isometric/client";
import { listProjects } from "@/lib/isometric/projects";
import {
  certifierCredentialsFormSchema,
  certifierCredentialsRotationSchema,
  setOrgCertifierCredentialsSchema,
} from "@/schemas/organizations";
import {
  E2E_CERTIFIER_ACCESS_TOKEN,
  E2E_CERTIFIER_CLIENT_SECRET,
  E2E_CERTIFIER_ROTATED_ACCESS_TOKEN,
} from "./e2e/fixtures/certifier-credentials";

const UNREACHABLE_BASE_URL = "http://127.0.0.1:1";

describe("self-service credential fixture", () => {
  it.each([E2E_CERTIFIER_ACCESS_TOKEN, E2E_CERTIFIER_ROTATED_ACCESS_TOKEN])(
    "survives form and action validation for %s",
    (accessToken) => {
      const credentials = {
        accessToken,
        clientSecret: E2E_CERTIFIER_CLIENT_SECRET,
      };
      expect(certifierCredentialsFormSchema.parse(credentials)).toEqual(credentials);
      expect(certifierCredentialsRotationSchema.parse(credentials)).toEqual(credentials);
      expect(setOrgCertifierCredentialsSchema.parse({
        organizationId: "e2e-credentials-org",
        ...credentials,
      })).toMatchObject(credentials);
    },
  );

  it("fails the real client's connection check before any request leaves", async () => {
    vi.useFakeTimers();
    try {
      // A refused loopback port: if the secret ever became a valid header, the
      // request would fail on connect instead, without the ByteString message.
      const client = createIsometricClient({
        accessToken: E2E_CERTIFIER_ACCESS_TOKEN,
        clientSecret: E2E_CERTIFIER_CLIENT_SECRET,
        baseUrl: UNREACHABLE_BASE_URL,
      });
      const outcome = listProjects(client).catch((error: unknown) => error);
      // Skip the jittered retry sleeps between the three attempts.
      await vi.runAllTimersAsync();
      const error = await outcome;
      expect(error).toBeInstanceOf(IsometricApiError);
      expect(error).toMatchObject({
        code: "network",
        message: expect.stringContaining("ByteString"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
