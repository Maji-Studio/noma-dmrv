import { describe, expect, it } from "vitest";
import {
  buildVerifierReportUrl,
  generateVerifierToken,
  hashVerifierToken,
  verifyReportCapabilityToken,
} from "./verifier-url";

const REPORT_ID = "11111111-1111-4111-8111-111111111111";

describe("GHG Statement verifier capability URL", () => {
  it("builds an unguessable token and verifies it against the stored hash", () => {
    const token = generateVerifierToken();
    const url = new URL(buildVerifierReportUrl(REPORT_ID, token));

    expect(url.searchParams.get("token")).toBe(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(verifyReportCapabilityToken(token, hashVerifierToken(token))).toBe(
      true,
    );
    expect(
      verifyReportCapabilityToken(`${token}x`, hashVerifierToken(token)),
    ).toBe(false);
  });

  it("mints a distinct token per call so links are revocable by rotation", () => {
    expect(generateVerifierToken()).not.toBe(generateVerifierToken());
  });

  it("rejects a token that was valid before rotation", () => {
    const oldToken = generateVerifierToken();
    const rotatedHash = hashVerifierToken(generateVerifierToken());

    expect(verifyReportCapabilityToken(oldToken, rotatedHash)).toBe(false);
  });

  it("rejects empty tokens and malformed stored hashes", () => {
    const token = generateVerifierToken();

    expect(verifyReportCapabilityToken("", hashVerifierToken(token))).toBe(
      false,
    );
    expect(verifyReportCapabilityToken(token, "not-a-hash")).toBe(false);
  });
});
