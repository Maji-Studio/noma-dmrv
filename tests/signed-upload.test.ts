import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_UPLOAD_ALLOWLIST =
  process.env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST;

async function loadSignedUploadHelpers() {
  vi.resetModules();
  return import("@/lib/isometric/utils/signed-upload");
}

afterEach(() => {
  if (ORIGINAL_UPLOAD_ALLOWLIST === undefined) {
    delete process.env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST;
  } else {
    process.env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST = ORIGINAL_UPLOAD_ALLOWLIST;
  }
  vi.resetModules();
});

describe("signed upload host allowlist", () => {
  it("allows storage-specific S3 hosts and rejects broad AWS hosts by default", async () => {
    delete process.env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST;
    const { assertUploadHostAllowed } = await loadSignedUploadHelpers();

    expect(() =>
      assertUploadHostAllowed("https://bucket.s3.amazonaws.com/object"),
    ).not.toThrow();
    expect(() =>
      assertUploadHostAllowed("https://bucket.s3.eu-west-1.amazonaws.com/object"),
    ).not.toThrow();
    expect(() =>
      assertUploadHostAllowed(
        "https://bucket.s3.dualstack.us-east-1.amazonaws.com/object",
      ),
    ).not.toThrow();
    expect(() =>
      assertUploadHostAllowed("https://sts.amazonaws.com/token"),
    ).toThrow(/not in ISOMETRIC_UPLOAD_HOST_ALLOWLIST/);
  });

  it("allows the GCS object host but rejects other googleapis.com hosts by default", async () => {
    delete process.env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST;
    const { assertUploadHostAllowed } = await loadSignedUploadHelpers();

    expect(() =>
      assertUploadHostAllowed(
        "https://bucket.storage.googleapis.com/object",
      ),
    ).not.toThrow();
    expect(() =>
      assertUploadHostAllowed("https://bigquery.googleapis.com/upload"),
    ).toThrow(/not in ISOMETRIC_UPLOAD_HOST_ALLOWLIST/);
  });

  it("allows broad AWS hosts only through explicit env opt-in", async () => {
    process.env.ISOMETRIC_UPLOAD_HOST_ALLOWLIST = ".amazonaws.com";
    const { assertUploadHostAllowed } = await loadSignedUploadHelpers();

    expect(() =>
      assertUploadHostAllowed("https://sts.amazonaws.com/token"),
    ).not.toThrow();
  });
});
