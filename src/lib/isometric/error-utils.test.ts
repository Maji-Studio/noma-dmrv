import { describe, expect, it } from "vitest";
import { DATAPOINT_DESCRIPTION_MAX_LENGTH } from "@/lib/certification/emission-entry-carry-copy";
import { IsometricApiError } from "./client";
import { describeIsometricApiError } from "./error-utils";

const VALIDATION_STATUS = 422;
const PREFIX = `Provider rejected the request (${VALIDATION_STATUS}): `;

function describeBody(body: unknown): string {
  return describeIsometricApiError(new IsometricApiError("Request failed", VALIDATION_STATUS, body));
}

describe("describeIsometricApiError", () => {
  it("surfaces FastAPI validation details without echoing the rejected input", () => {
    const body = {
      detail: [{
        type: "string_too_long",
        loc: ["body", "description"],
        msg: "String should have at most 500 characters",
        input: "REJECTED_INPUT_MUST_NOT_APPEAR",
        ctx: { max_length: DATAPOINT_DESCRIPTION_MAX_LENGTH },
      }],
    };
    expect(describeBody(body)).toBe(`${PREFIX}description: String should have at most 500 characters`);
    expect(describeBody(body)).not.toContain(body.detail[0].input);
  });

  it.each(["body", "query", "path"])("strips a leading %s location and joins nested fields", source => {
    expect(describeBody({ detail: [{ loc: [source, "items", 0, "quantity"], msg: "Invalid value" }] }))
      .toBe(`${PREFIX}items.0.quantity: Invalid value`);
  });

  it("keeps a location without a request-source prefix", () => {
    expect(describeBody({ detail: [{ loc: ["items", "body"], msg: "Invalid value" }] }))
      .toBe(`${PREFIX}items.body: Invalid value`);
  });

  it.each([undefined, [], ["body"], ["query"], ["path"]])("uses just the message for location %j", loc => {
    expect(describeBody({ detail: [{ loc, msg: "Invalid value" }] })).toBe(`${PREFIX}Invalid value`);
  });

  it("finds the first object with a string msg", () => {
    expect(describeBody({ detail: [null, "invalid", {}, { msg: 42 },
      { loc: ["body", "description"], msg: "First validation error" },
      { msg: "Second validation error" }] }))
      .toBe(`${PREFIX}description: First validation error`);
  });

  it("continues to sanitize validation messages", () => {
    expect(describeBody({ detail: [{ loc: ["body", "quantity"], msg: "Invalid value, params: private fixture data" }] }))
      .toBe(`${PREFIX}quantity: Invalid value, params: [REDACTED]`);
  });

  it.each(["message", "detail", "error", "reason"])("preserves the existing string %s reason", key => {
    expect(describeBody({ [key]: "Existing reason" })).toBe(`${PREFIX}Existing reason`);
  });

  it.each(["Existing reason", { errors: ["Existing reason"] }, { errors: [{ message: "Existing reason" }] }])(
    "preserves the existing body and errors reasons for %j", body => {
      expect(describeBody(body)).toBe(`${PREFIX}Existing reason`);
    },
  );

  it("falls through malformed details to an existing reason", () => {
    expect(describeBody({ detail: [{ input: "REJECTED_INPUT_MUST_NOT_APPEAR" }], reason: "Existing reason" }))
      .toBe(`${PREFIX}Existing reason`);
  });

  it("preserves the status-only fallback when no reason exists", () => {
    expect(describeBody({ detail: [] })).toBe(`Provider rejected the request (${VALIDATION_STATUS}).`);
  });
});
