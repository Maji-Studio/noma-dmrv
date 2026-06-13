import { describe, expect, it } from "vitest";
import { IsometricApiError } from "@/lib/isometric";
import {
  describeIsometricApiError,
  sanitizeIsometricErrorBody,
} from "@/lib/isometric/error-utils";

describe("Isometric error utilities", () => {
  it("redacts secret and PII-like keys before persistence", () => {
    const sanitized = sanitizeIsometricErrorBody({
      detail: "report URL is not allowed",
      authorization: "Bearer abc",
      client_secret: "secret",
      nested: {
        email: "operator@example.com",
        token: "token-value",
      },
    });

    expect(sanitized).toEqual({
      detail: "report URL is not allowed",
      authorization: "[REDACTED]",
      client_secret: "[REDACTED]",
      nested: {
        email: "[REDACTED]",
        token: "[REDACTED]",
      },
    });
  });

  it("summarizes the first provider reason for operator-facing errors", () => {
    const error = new IsometricApiError(
      "Isometric POST /ghg_statements/id/submit -> 400",
      400,
      { errors: [{ detail: "report URL host is not allowed" }] },
      "http",
    );

    expect(describeIsometricApiError(error)).toBe(
      "Provider rejected the request (400): report URL host is not allowed",
    );
  });
});
