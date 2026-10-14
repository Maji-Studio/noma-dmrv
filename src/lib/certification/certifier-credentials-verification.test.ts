import { describe, expect, it } from "vitest";
import {
  CERTIFIER_VERIFICATION_MESSAGES,
  certifierVerificationFailureMessage,
  certifierVerificationSuccessMessage,
} from "./certifier-credentials-verification";

describe("certifier credential verification messages", () => {
  it.each([
    [0, CERTIFIER_VERIFICATION_MESSAGES.noProjects],
    [1, "Connected to Isometric. 1 project available to link."],
    [3, "Connected to Isometric. 3 projects available to link."],
  ])("reports %i visible projects", (count, message) => {
    expect(certifierVerificationSuccessMessage(count)).toBe(message);
  });

  it.each([
    [null, CERTIFIER_VERIFICATION_MESSAGES.checkUnavailable],
    [{ code: "not_configured" as const }, CERTIFIER_VERIFICATION_MESSAGES.notConfigured],
    [{ code: "network" as const }, CERTIFIER_VERIFICATION_MESSAGES.network],
    [{ code: "http" as const, status: 401 }, CERTIFIER_VERIFICATION_MESSAGES.rejected],
    [{ code: "http" as const, status: 403 }, CERTIFIER_VERIFICATION_MESSAGES.rejected],
    [
      { code: "http" as const, status: 500 },
      "Keys saved, but Isometric returned an error (500). Check the keys, then save again.",
    ],
    [
      { code: "http" as const },
      "Keys saved, but Isometric returned an error (no status code). Check the keys, then save again.",
    ],
  ])("explains failure %j", (failure, message) => {
    expect(certifierVerificationFailureMessage(failure)).toBe(message);
  });
});
