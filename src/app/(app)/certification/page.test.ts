/**
 * Tests for the certification root redirect URL-building logic.
 *
 * The CertificationHomeRedirect server component (certification/page.tsx) builds
 * a URLSearchParams string from its incoming searchParams and redirects to
 * /certification/removals, preserving all query parameters (including the
 * `?facility=` scope anchor). These tests capture that contract.
 */
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// buildRedirectQuery — mirrors the URL-building logic in certification/page.tsx
//
// The component does:
//   const params = new URLSearchParams();
//   for (const [key, value] of Object.entries(sp)) {
//     if (Array.isArray(value)) {
//       for (const entry of value) params.append(key, entry);
//     } else if (value) {
//       params.set(key, value);
//     }
//   }
//   const query = params.toString();
//   redirect(`/certification/removals${query ? `?${query}` : ""}`);
// ---------------------------------------------------------------------------
function buildRedirectQuery(
  sp: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
    } else if (value) {
      params.set(key, value);
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function redirectTarget(sp: Record<string, string | string[] | undefined>): string {
  const query = buildRedirectQuery(sp);
  return `/certification/removals${query}`;
}

describe("CertificationHomeRedirect URL building", () => {
  it("redirects to /certification/removals with no query when searchParams is empty", () => {
    expect(redirectTarget({})).toBe("/certification/removals");
  });

  it("preserves a single facility param", () => {
    const target = redirectTarget({ facility: "fac-abc123" });
    expect(target).toBe("/certification/removals?facility=fac-abc123");
  });

  it("preserves multiple distinct params", () => {
    const target = redirectTarget({ facility: "fac-1", removal: "rem-2" });
    const url = new URL(target, "http://localhost");
    expect(url.searchParams.get("facility")).toBe("fac-1");
    expect(url.searchParams.get("removal")).toBe("rem-2");
  });

  it("appends all entries for array-valued params", () => {
    const target = redirectTarget({ tag: ["a", "b", "c"] });
    const url = new URL(target, "http://localhost");
    expect(url.searchParams.getAll("tag")).toEqual(["a", "b", "c"]);
  });

  it("handles a mix of string and array params", () => {
    const target = redirectTarget({ facility: "fac-1", tag: ["x", "y"] });
    const url = new URL(target, "http://localhost");
    expect(url.searchParams.get("facility")).toBe("fac-1");
    expect(url.searchParams.getAll("tag")).toEqual(["x", "y"]);
  });

  it("filters out undefined-valued params", () => {
    const target = redirectTarget({ facility: "fac-1", missing: undefined });
    const url = new URL(target, "http://localhost");
    expect(url.searchParams.has("missing")).toBe(false);
    expect(url.searchParams.get("facility")).toBe("fac-1");
  });

  it("filters out empty-string-valued params (treated as falsy)", () => {
    // The component uses `else if (value)` — empty string is falsy.
    const target = redirectTarget({ facility: "fac-1", empty: "" });
    const url = new URL(target, "http://localhost");
    expect(url.searchParams.has("empty")).toBe(false);
  });

  it("URL-encodes special characters in param values", () => {
    const target = redirectTarget({ facility: "my facility/1" });
    // The facility value must be encoded in the query string.
    expect(target).toContain("facility=my+facility%2F1");
  });

  it("always starts with /certification/removals", () => {
    expect(redirectTarget({}).startsWith("/certification/removals")).toBe(true);
    expect(
      redirectTarget({ facility: "fac-1" }).startsWith("/certification/removals"),
    ).toBe(true);
  });

  it("the redirect preserves ?facility= to maintain scope across the nav change", () => {
    // This is the primary backward-compatibility guarantee of the redirect:
    // old bookmarks / links with ?facility= should land on Removals in the
    // correct facility context.
    const facilityId = "fac-xyz-999";
    const target = redirectTarget({ facility: facilityId });
    const url = new URL(target, "http://localhost");
    expect(url.pathname).toBe("/certification/removals");
    expect(url.searchParams.get("facility")).toBe(facilityId);
  });
});