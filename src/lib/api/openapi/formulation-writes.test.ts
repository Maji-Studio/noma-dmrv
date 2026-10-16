import { describe, expect, it } from "vitest";
import { API_FORMULATION_MAX_LINES } from "@/config/api-formulations";
import { FORMULATION_RATIO_STEP } from "@/lib/formulation-ratios";
import { llmsGuide } from "../llms-guide";
import { createFormulationInput, updateFormulationApiInput } from "@/schemas/formulation-input";
import { operationInput } from "./operation-kit";
import { buildOpenApiDocument } from "./document";

const document = buildOpenApiDocument();
type Body = { content: { "application/json": { schema: ReturnType<typeof operationInput>; example?: unknown } }; required: boolean };
const request = (path: string, method: string) => document.paths[path][method].requestBody as Body;

describe("formulation OpenAPI writes", () => {
  it("introduces formulation writes in both published agent guides", () => {
    for (const text of [document.info.description, llmsGuide]) {
      expect(text).not.toContain("including formulations");
      expect(text).not.toContain("formulations (formulations:read) are read-only");
      expect(text).toContain("POST /formulations with Idempotency-Key");
      expect(text).toContain("PATCH and DELETE /formulations/{id}");
      expect(text).toContain("POST /formulations/{id}/archive and /restore");
      expect(text).toContain("UUID paths with If-Match");
      expect(text).toContain("formulations:write for create, update, archive and restore");
      expect(text).toContain("formulations:delete for delete");
    }
  });
  it("publishes the strict shared create and partial update contracts with millionth bounds", () => {
    const body = request("/formulations", "post");
    expect(body.content["application/json"].schema).toEqual(operationInput(createFormulationInput));
    expect(createFormulationInput.safeParse(body.content["application/json"].example).success).toBe(true);
    expect(body.content["application/json"].schema).toMatchObject({ additionalProperties: false, required: ["name"], properties: {
      biocharRatio: { anyOf: [{ type: "number", minimum: 0, maximum: 1, multipleOf: FORMULATION_RATIO_STEP }, { type: "null" }] },
      lines: { maxItems: API_FORMULATION_MAX_LINES, items: { additionalProperties: false } },
    } });
    const patch = request("/formulations/{idOrCode}", "patch");
    expect(patch.content["application/json"].schema).toEqual(operationInput(updateFormulationApiInput));
    expect(patch.content["application/json"].schema.properties).not.toHaveProperty("formulationId");
    expect(patch.content["application/json"].schema.properties).not.toHaveProperty("expectedVersion");
  });
  it("documents create keys, command preconditions, scopes and typed current responses", () => {
    expect(document.components.schemas.FormulationPreconditionProblem.allOf).toEqual([
      { $ref: "#/components/schemas/Problem" },
      expect.objectContaining({ properties: { current: expect.objectContaining({ $ref: "#/components/schemas/formulation" }) }, required: ["current"] }),
    ]);
    const create = document.paths["/formulations"].post;
    expect(create.operationId).toBe("create_formulation");
    expect(create.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: true }));
    expect(create.responses["201"]).toMatchObject({ headers: { ETag: expect.any(Object), Location: expect.any(Object) } });
    expect(create.responses["200"]).not.toHaveProperty("headers.ETag");
    for (const [method, suffix, operation, scope] of [
      ["patch", "", "update_formulation", "formulations:write"],
      ["delete", "", "delete_formulation", "formulations:delete"],
      ["post", "/archive", "archive_formulation", "formulations:write"],
      ["post", "/restore", "restore_formulation", "formulations:write"],
    ]) {
      const write = document.paths[`/formulations/{idOrCode}${suffix}`][method];
      expect(write).toMatchObject({ operationId: operation, "x-required-scope": scope });
      expect(write.parameters).toContainEqual(expect.objectContaining({ name: "If-Match", required: true }));
      expect(write.parameters).toContainEqual(expect.objectContaining({ name: "Idempotency-Key", required: false }));
      expect(write.responses).toHaveProperty("428");
      expect(write.responses["412"]).toEqual({ $ref: "#/components/responses/FormulationProblem412" });
      if (suffix || method === "delete") expect(request(`/formulations/{idOrCode}${suffix}`, method)).toMatchObject({ required: false, content: { "application/json": { schema: { type: "object", additionalProperties: false } } } });
    }
  });
});
