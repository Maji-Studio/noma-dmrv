import { deriveEntryCorrection, type EntryCorrectionState } from "./removal-entry-correction";
import type { EntryInputManifest } from "./removal-emission-contributions";

// These are descriptive fields in compiler snapshots, not submitted quantities
// or evidence identities. Normalize old snapshots as well as current builds.
const DISPLAY_FIELDS = new Set(["entityLabel", "applicationCode", "label", "displayName", "display_name", "name", "description", "notes", "code"]);

function canonical(value: unknown): string {
  function normalize(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item)
      .filter(([key]) => !DISPLAY_FIELDS.has(key)).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, normalize(child)]));
    return item;
  }
  return JSON.stringify(normalize(value ?? null));
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
}

function components(semantic: Record<string, unknown>): string[] {
  return [...rows(semantic.inputs), ...rows(semantic.sequestrationTemplate)]
    .flatMap(input => typeof input.rtcId === "string" ? [input.rtcId] : []);
}

/** Entry evidence already has exact component/batch attribution in the manifest. */
function sharedEvidence(semantic: Record<string, unknown>) {
  const entrySourceIds = new Set(rows(semantic.sourceBindingPlan)
    .filter(binding => binding.nomaRole === "emission_entry").map(binding => binding.sourceId));
  return {
    sourceIds: Array.isArray(semantic.sourceIds) ? semantic.sourceIds.filter(id => !entrySourceIds.has(id)) : [],
    candidateSources: rows(semantic.candidateSources).filter(candidate => {
      const binding = candidate.binding;
      return !binding || typeof binding !== "object" || !("nomaRole" in binding) || binding.nomaRole !== "emission_entry";
    }),
  };
}

/** Shared changes need resubmission without inventing component attribution. */
export function deriveRemovalSemanticCorrection(args: {
  windowOpen: boolean;
  previous: Record<string, unknown>;
  current: Record<string, unknown> | null;
  previousEntries: readonly EntryInputManifest[];
  currentEntries: readonly EntryInputManifest[];
  componentIds: string[];
  batchIds: string[];
}): EntryCorrectionState {
  const state = deriveEntryCorrection(args.windowOpen, args.previousEntries, args.currentEntries);
  if (!args.windowOpen) return state;
  const ids = [...new Set([...args.componentIds, ...components(args.previous), ...components(args.current ?? {})])].sort();
  const changed = new Set(args.current ? state.changedComponentIds : []);
  const lineageChanged = new Set<string>();
  const previous = args.previous;
  const current = args.current;
  const sharedKeys = ["startedOn", "completedOn", "sourceProductionRunIds", "biocharApplicationIntents", "templateId", "externalProjectId"];
  const sharedChanged = !current || (sharedKeys.some(key => canonical(previous[key]) !== canonical(current[key])) || canonical(sharedEvidence(previous)) !== canonical(sharedEvidence(current)));
  for (const id of current ? ids : []) {
    const inputs = (semantic: Record<string, unknown>) => rows(semantic.inputs).filter(input => input.rtcId === id);
    const storage = (semantic: Record<string, unknown>) => rows(semantic.sequestrationTemplate).filter(input => input.rtcId === id);
    const sources = (semantic: Record<string, unknown>) => rows(semantic.sourceBindingPlan).filter(input => !!input.intendedTarget && typeof input.intendedTarget === "object" && "componentId" in input.intendedTarget && input.intendedTarget.componentId === id);
    const omitted = (semantic: Record<string, unknown>) => Array.isArray(semantic.omittedTemplateComponentIds) && semantic.omittedTemplateComponentIds.includes(id);
    if (current && (canonical(inputs(previous)) !== canonical(inputs(current)) ||
      canonical(sources(previous)) !== canonical(sources(current)) || omitted(previous) !== omitted(current) ||
      canonical(storage(previous)) !== canonical(storage(current)) ||
      ((storage(previous).length || storage(current).length) && canonical(previous.durabilityMeasurementSamples) !== canonical(current.durabilityMeasurementSamples)))) {
      changed.add(id);
      lineageChanged.add(id);
    }
  }
  const changedComponentIds = [...changed].sort();
  const pairs = new Map((current ? state.changedPairs ?? [] : []).map(pair => [JSON.stringify(pair), pair]));
  for (const componentId of changedComponentIds) {
    // Entry-only changes retain exact batch attribution. Compiled lineage values
    // aggregate the member batches, so their affected scope is the full membership.
    if (lineageChanged.has(componentId)) {
      for (const batchId of args.batchIds) {
        const pair = { componentId, batchId };
        pairs.set(JSON.stringify(pair), pair);
      }
    }
  }
  const changedPairs = [...pairs.values()];
  const count = changedComponentIds.length;
  return { ...state, changedComponentIds, changedPairs,
    changedBatchIds: sharedChanged ? args.batchIds : [...new Set(changedPairs.map(pair => pair.batchId))], correctionNeeded: sharedChanged || count > 0,
    message: count ? `Resubmit needed: ${count} ${count === 1 ? "component" : "components"} changed since this Removal was sent.` : sharedChanged ? "Resubmit needed: records or files changed since this Removal was sent." : null };
}
