import { SafeError } from "@/lib/errors";
import type { AggregatedProductionData } from "./utils/aggregation";
import { normalizeComponentDisplayName, ownValue } from "./semantic-binding-catalog";
import { lookupBindingTriple, projectInputMapping, projectPeriodInputTuples, type InputMappingEntry, type InputMappingTable } from "./semantic-binding-projections";

// Maps (group_key, blueprint_key, input_key) tuples to a noma aggregated
// source field. A projection of the semantic binding catalog
// (src/lib/isometric/semantic-binding-catalog.ts), which owns every entry and
// its rationale; edit the catalog, never this table. The 3-level structure is
// required because blueprints repeat across groups with different meaning
// (`mass_distance` is feedstock, biochar or sample transport by group).
//
// Validated against the live blueprint at submit time (see
// buildCreateDatapointRequest) so a key that drifts from the catalog
// surfaces immediately rather than silently producing a malformed datapoint.
export const INPUT_MAPPING: InputMappingTable = projectInputMapping();

export function lookupInputMapping(
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
): InputMappingEntry | undefined {
  return lookupBindingTriple(
    INPUT_MAPPING,
    groupKey,
    blueprintKey,
    inputKey,
  );
}

// Resolves the aggregated-source field for a mapping. Usually just
// `mapping.source`; when the mapping carries a per-component override (the
// catalog's disambiguation rule for a triple declared by >1 template
// component — e.g. the pyrolysis diesel split), it resolves by normalized
// component display name and FAILS CLOSED on an
// unrecognized name so a rename/added component can never silently double-count
// or land in the wrong bucket.
export function resolveDatapointSource(
  mapping: InputMappingEntry,
  componentDisplayName: string | undefined,
): keyof AggregatedProductionData {
  if (!mapping.sourceByComponent) return mapping.source;
  const normalized = normalizeComponentDisplayName(componentDisplayName);
  const resolved = ownValue(mapping.sourceByComponent, normalized);
  if (!resolved) {
    throw new SafeError(`The pyrolysis diesel component is not recognized. ${componentRenameGuidance(mapping)}`);
  }
  return resolved;
}

/** Shared rename guidance for the builder and early template coverage. */
export function componentRenameGuidance(mapping: InputMappingEntry): string {
  const expected = Object.keys(mapping.sourceByComponent ?? {})
    .map((name) => `"${name}"`)
    .join(", ");
  return `Rename it in Isometric to one of these names: ${expected}.`;
}

// Tuples that lived in INPUT_MAPPING as `zeroStub: true` families before ADR
// 0005. Their data lives as `PROJECT`-scope Components authored and sourced
// entirely in the Isometric UI (ADR 0018 - noma keeps no copy), except for an
// explicitly named component in a mapping's `sourceByComponent` carve-out. A
// Removal Template that declares any other component for these tuples is wrong
// by construction. `buildCreateDatapointRequest` consults this set before the
// INPUT_MAPPING lookup, so a conflicting entry without a named carve-out can
// never bypass the guard and the resulting `SafeError` names the canonical
// scope rather than just "missing mapping".
//
// A projection of the catalog's project-scope roles (ADR 0018): edit the
// catalog, never this table.
const PERIOD_INPUT_TUPLES = projectPeriodInputTuples();

export function lookupPeriodInputTuple(
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
  // Template component display name. A period tuple is released from the
  // PROJECT-scope guard ONLY when an INPUT_MAPPING entry for the same triple
  // names this exact component in `sourceByComponent` - i.e. the carve-out is
  // per component, never per tuple. Omitting the name keeps the guard armed
  // (fail-closed default).
  componentDisplayName?: string,
): { category: string } | undefined {
  const tuple = lookupBindingTriple(
    PERIOD_INPUT_TUPLES,
    groupKey,
    blueprintKey,
    inputKey,
  );
  if (!tuple) return undefined;
  const carveOut = lookupInputMapping(groupKey, blueprintKey, inputKey)
    ?.sourceByComponent;
  const normalized = normalizeComponentDisplayName(componentDisplayName);
  if (carveOut && ownValue(carveOut, normalized)) return undefined;
  return tuple;
}

