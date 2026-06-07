import { describe, expect, it } from "vitest";
import {
  AGGREGATED_PRODUCTION_DATA_KEYS,
  CERTIFY_FIELD_REGISTRY,
} from "@/lib/certification/certify-field-registry";
import { INPUT_MAPPING } from "@/lib/isometric/transformers/datapoint";

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

  it("keeps declared INPUT_MAPPING tuples in sync with their sources", () => {
    const mismatches: string[] = [];

    for (const [entityKind, descriptors] of Object.entries(
      CERTIFY_FIELD_REGISTRY,
    )) {
      for (const descriptor of descriptors) {
        for (const registryMapping of descriptor.mappings ?? []) {
          for (const inputTuple of registryMapping.inputTuples ?? []) {
            const mapping =
              INPUT_MAPPING[inputTuple.groupKey]?.[inputTuple.blueprintKey]?.[
                inputTuple.inputKey
              ];
            const tupleKey = `${inputTuple.groupKey}/${inputTuple.blueprintKey}/${inputTuple.inputKey}`;
            if (!mapping) {
              mismatches.push(`${entityKind}.${descriptor.key}: missing ${tupleKey}`);
              continue;
            }
            if (mapping.source !== registryMapping.source) {
              mismatches.push(
                `${entityKind}.${descriptor.key}: ${tupleKey} maps to ${String(
                  mapping.source,
                )}, registry says ${String(registryMapping.source)}`,
              );
            }
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});
