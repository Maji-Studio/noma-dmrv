/**
 * Document-redirect host allowlist (`/api/documents/[id]` legacy fileUrl).
 *
 * Mirrors tests/signed-upload.test.ts — verifies the narrow default families,
 * that the broad provider hosts the old wildcard allowed are now rejected, and
 * that the ISOMETRIC_STORAGE_REDIRECT_HOSTS env override replaces the defaults.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL = process.env.ISOMETRIC_STORAGE_REDIRECT_HOSTS;

async function loadGuard() {
  vi.resetModules();
  return import("@/lib/documents/redirect-allowlist");
}

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.ISOMETRIC_STORAGE_REDIRECT_HOSTS;
  } else {
    process.env.ISOMETRIC_STORAGE_REDIRECT_HOSTS = ORIGINAL;
  }
  vi.resetModules();
});

describe("document redirect allowlist", () => {
  it("allows the narrow storage families + isometric.com by default", async () => {
    delete process.env.ISOMETRIC_STORAGE_REDIRECT_HOSTS;
    const { isAllowedRedirectHost } = await loadGuard();

    expect(isAllowedRedirectHost("files.isometric.com")).toBe(true);
    expect(isAllowedRedirectHost("bucket.s3.amazonaws.com")).toBe(true);
    expect(isAllowedRedirectHost("bucket.s3.eu-west-1.amazonaws.com")).toBe(true);
    expect(isAllowedRedirectHost("bucket.s3.dualstack.us-east-1.amazonaws.com")).toBe(
      true,
    );
    expect(isAllowedRedirectHost("bucket.storage.googleapis.com")).toBe(true);
    expect(isAllowedRedirectHost("noma.fra1.digitaloceanspaces.com")).toBe(true);
  });

  it("rejects the broad provider hosts the old wildcard let through", async () => {
    delete process.env.ISOMETRIC_STORAGE_REDIRECT_HOSTS;
    const { isAllowedRedirectHost } = await loadGuard();

    expect(isAllowedRedirectHost("maps.googleapis.com")).toBe(false); // was .googleapis.com
    expect(isAllowedRedirectHost("sts.amazonaws.com")).toBe(false); // was .amazonaws.com
    expect(isAllowedRedirectHost("console.aws.amazon.com")).toBe(false);
    expect(isAllowedRedirectHost("example.com")).toBe(false);
    // leading-dot normalization blocks look-alikes
    expect(isAllowedRedirectHost("evilisometric.com")).toBe(false);
    expect(isAllowedRedirectHost("evilamazonaws.com")).toBe(false);
  });

  it("env override REPLACES the defaults with an explicit host", async () => {
    process.env.ISOMETRIC_STORAGE_REDIRECT_HOSTS =
      "isometric-reports.s3.eu-west-1.amazonaws.com";
    const { isAllowedRedirectHost } = await loadGuard();

    expect(
      isAllowedRedirectHost("isometric-reports.s3.eu-west-1.amazonaws.com"),
    ).toBe(true);
    // defaults (and the built-in S3 patterns) no longer apply once overridden
    expect(isAllowedRedirectHost("files.isometric.com")).toBe(false);
    expect(isAllowedRedirectHost("other.s3.amazonaws.com")).toBe(false);
  });
});
