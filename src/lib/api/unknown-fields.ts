import type { JsonSchema } from "@/lib/operations/json-schema";
import { DomainError, type DomainIssue } from "@/lib/domain-errors";

/** Check property names against the published contract; Zod still checks values. */
export function unknownFieldIssues(value: unknown, schema: JsonSchema): DomainIssue[] {
  function visit(value: unknown, node: JsonSchema, path: (string | number)[]): DomainIssue[] {
    if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
      const target = node.$ref.slice(2).split("/").reduce<unknown>((current, key) =>
        current && typeof current === "object"
          ? (current as JsonSchema)[key.replaceAll("~1", "/").replaceAll("~0", "~")]
          : undefined, schema);
      if (target && typeof target === "object") return visit(value, target as JsonSchema, path);
    }
    const branches = node.anyOf ?? node.oneOf;
    if (Array.isArray(branches)) {
      const applicable = branches.filter((branch: JsonSchema) =>
        Array.isArray(value) ? branch.type === "array" || branch.$ref
          : value !== null && typeof value === "object" ? branch.type === "object" || branch.properties || branch.$ref
            : true);
      const candidates = applicable.map((branch) => visit(value, branch, path));
      return candidates.sort((a, b) => a.length - b.length)[0] ?? [];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => visit(item, (node.items as JsonSchema) ?? {}, [...path, index]));
    }
    if (value === null || typeof value !== "object" || !node.properties) return [];
    const properties = node.properties as Record<string, JsonSchema>;
    return Object.entries(value).flatMap(([key, child]) => {
      const childPath = [...path, key];
      if (!Object.hasOwn(properties, key)) {
        return [{ path: childPath, code: "unknown_field", message: "This property is not accepted." }];
      }
      return visit(child, properties[key], childPath);
    });
  }
  return visit(value, schema, []);
}

export function rejectUnknownFields(value: unknown, schema: JsonSchema): void {
  const issues = unknownFieldIssues(value, schema);
  if (issues.length) throw new DomainError("validation_failed", "Remove unrecognized properties.", { issues });
}
