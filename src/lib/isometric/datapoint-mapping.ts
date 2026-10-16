import { REMOVAL_TEMPLATE_BLOCKERS } from "@/lib/certification/removal-template-blockers";
import { effectiveContract, type LineContract } from "./template-observations/line-sources";
import { automaticSourceFact } from "./template-observations/catalog-sources";
import { SafeError } from "@/lib/errors";
import type { AggregatedProductionData } from "./utils/aggregation";
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
  contract?: LineContract,
): InputMappingEntry | undefined {
  const mapping = lookupBindingTriple(
    INPUT_MAPPING,
    groupKey,
    blueprintKey,
    inputKey,
  );
  if (!mapping || !contract) return mapping;
  const effective = effectiveContract(contract);
  if (effective.scope !== "operating") return undefined;
  // Stored inputs compile from Samples and applications. A per-component stored
  // source (the Safety margin carve-out) still needs its reviewed contract.
  if (effective.automaticSource === "sequestration" || (mapping.bucket === "stored" && !mapping.sourceByComponent)) return mapping;
  if (effective.automaticSource) return { ...mapping, source: automaticSourceFact(effective.automaticSource), sourceByComponent: undefined };
  // A contract without an automatic source is entry-only; the catalog default
  // would feed one total to every such line (two sample shipping lines).
  return undefined;
}

// Shared triples require an effective automatic contract, including diesel.
export function resolveDatapointSource(
  mapping: InputMappingEntry,
  contract?: LineContract,
): keyof AggregatedProductionData {
  const effective = contract && effectiveContract(contract);
  if (effective?.scope === "operating" && (effective.automaticSource === "sequestration" || (mapping.bucket === "stored" && !mapping.sourceByComponent))) return mapping.source;
  if (effective?.scope === "operating" && effective.automaticSource) return automaticSourceFact(effective.automaticSource);
  if (contract || mapping.sourceByComponent) {
    throw new SafeError(REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview);
  }
  return mapping.source;
}

// Project-scope tuples remain registry-authored. An effective automatic
// contract is the only carve-out; display labels carry no binding authority.
const PERIOD_INPUT_TUPLES = projectPeriodInputTuples();

/** ADR 0005: only sandbox submissions may use zero stubs for period inputs. */
export function allowsPeriodInputStub(environment: string | undefined): boolean {
  return environment === "sandbox";
}

export function lookupPeriodInputTuple(
  groupKey: string,
  blueprintKey: string,
  inputKey: string,
  contract?: LineContract,
): { category: string } | undefined {
  const tuple = lookupBindingTriple(
    PERIOD_INPUT_TUPLES,
    groupKey,
    blueprintKey,
    inputKey,
  );
  if (!tuple) return undefined;
  const effective = contract && effectiveContract(contract);
  if (effective?.scope === "operating" && effective.automaticSource) return undefined;
  return tuple;
}
