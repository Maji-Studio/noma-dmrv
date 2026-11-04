import { describe, expect, it } from "vitest";
import { getSafeSignInPath } from "./sign-in-path";

const APP_ORIGIN = "https://app.example";

describe("getSafeSignInPath", () => {
  it.each([
    null, "", "credit-batches", "//x", "/\\x", "https://x",
    "/%09/x", "/%0A/x", "/%0D/x", "/\t/x", "/\n/x", "/\r/x",
    "/path\u0000", "/path\u001f", "/path\u007f", "/path?tab=\t", "/path#\n",
    "/.//x", "/%2e//x", "/a/..//x",
  ])("falls back to the app home for %j", from => {
    expect(getSafeSignInPath(from, APP_ORIGIN)).toBe("/");
  });

  it.each(["/%09/x", "/%0A/x", "/%0D/x"])("rejects a decoded login query: %s", from => {
    const query = new URLSearchParams(`from=${from}`);
    expect(getSafeSignInPath(query.get("from"), APP_ORIGIN)).toBe("/");
  });

  it.each(["/", "/credit-batches?tab=runs#a", "/search?q=hello%20world"])(
    "preserves a safe path, query and fragment: %s", from => {
      expect(getSafeSignInPath(from, APP_ORIGIN)).toBe(from);
    },
  );

  it("returns the parsed path after normalization", () => {
    expect(getSafeSignInPath("/old/../credit-batches?tab=runs#a", APP_ORIGIN))
      .toBe("/credit-batches?tab=runs#a");
  });

  it("fails closed for an invalid app origin", () => {
    expect(getSafeSignInPath("/credit-batches", "invalid")).toBe("/");
  });
});
