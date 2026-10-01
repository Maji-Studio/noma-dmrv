import { describe, expect, it } from "vitest";
import {
  AGGREGATED_PRODUCTION_DATA_KEYS,
  CERTIFY_FIELD_REGISTRY,
  resolveCertifyFieldInputTuples,
} from "@/lib/certification/certify-field-registry";
import {
  INPUT_MAPPING,
  lookupInputMapping,
} from "@/lib/isometric/transformers/datapoint";

function inputMappingSources(): Set<string> {
  const sources = new Set<string>();
  for (const blueprints of Object.values(INPUT_MAPPING)) {
    for (const inputs of Object.values(blueprints)) {
      for (const mapping of Object.values(inputs)) {
        sources.add(String(mapping.source));
      }
    }
  }
  return sources;
}

function registrySources(): Set<string> {
  const sources = new Set<string>();
  for (const descriptors of Object.values(CERTIFY_FIELD_REGISTRY)) {
    for (const descriptor of descriptors) {
      for (const mapping of descriptor.mappings ?? []) {
        sources.add(String(mapping.source));
      }
    }
  }
  return sources;
}

describe("CERTIFY_FIELD_REGISTRY drift guard", () => {
  it("covers every source submitted through INPUT_MAPPING", () => {
    const submittedSources = inputMappingSources();
    const coveredSources = registrySources();

    expect(
      [...submittedSources].filter((source) => !coveredSources.has(source)),
    ).toEqual([]);
  });

  it("only points at AggregatedProductionData keys", () => {
    const validSources = new Set<string>(AGGREGATED_PRODUCTION_DATA_KEYS);
    const coveredSources = registrySources();

    expect(
      [...coveredSources].filter((source) => !validSources.has(source)),
    ).toEqual([]);
  });

  it("resolves each field's input tuples to mappings that submit its sources", () => {
    const mismatches: string[] = [];

    for (const [entityKind, descriptors] of Object.entries(
      CERTIFY_FIELD_REGISTRY,
    )) {
      for (const descriptor of descriptors) {
        const fieldSources = new Set<string>(
          (descriptor.mappings ?? []).map((mapping) => mapping.source),
        );
        for (const inputTuple of resolveCertifyFieldInputTuples(descriptor)) {
          const tupleKey = `${inputTuple.groupKey}/${inputTuple.blueprintKey}/${inputTuple.inputKey}`;
          const mapping = lookupInputMapping(
            inputTuple.groupKey,
            inputTuple.blueprintKey,
            inputTuple.inputKey,
          );
          const submitted = mapping
            ? [mapping.source, ...Object.values(mapping.sourceByComponent ?? {})]
            : [];
          if (!submitted.some((source) => fieldSources.has(source))) {
            mismatches.push(`${entityKind}.${descriptor.key}: ${tupleKey}`);
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
