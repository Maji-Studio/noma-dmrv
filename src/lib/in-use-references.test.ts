import { describe, expect, it } from "vitest";
import { ActionError } from "@/lib/action-error";
import { inUseDeleteRefusal } from "@/lib/delete-refusal";
import { formulationInUse } from "@/lib/formulation-domain-errors";
import { formulationInUseReason } from "./in-use-references";

describe("formulationInUseReason", () => {
  it.each([
    { kind: "biochar products", phrase: "biochar products use it" },
    { kind: "product bins", phrase: "product bins use it" },
    { kind: "orders", phrase: "orders use it" },
  ] as const)("names $kind from the refusal meta", ({ kind, phrase }) => {
    const error = formulationInUse(kind, ["X-001"]);
    expect(error.message).toContain(phrase);
    expect(formulationInUseReason(new ActionError({ error: error.message, ...error }))).toBe(phrase);
  });

  it("returns undefined for a refusal that names no kind or a non-refusal", () => {
    expect(formulationInUseReason(new Error("boom"))).toBeUndefined();
    expect(formulationInUseReason(new ActionError({ error: "x", ...inUseDeleteRefusal("x", ["formulationId"]) }))).toBeUndefined();
  });
});
