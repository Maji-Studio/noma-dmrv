import { LINE_NO_MAPPING_MESSAGE, LINE_TRANSPORT_REPLACEMENT_MESSAGE, TRANSPORT_BLUEPRINT_KEY } from "@/lib/isometric/emission-line-constants";
import { lookupInputMapping, lookupPeriodInputTuple } from "@/lib/isometric/datapoint-mapping";
import { getSequestrationInputBinding, hasExplicitSequestrationBinding } from "@/lib/isometric/sequestration-input-bindings";
import { isSequestrationBlueprintFamily } from "@/lib/isometric/storage-blueprints";
import { effectiveContract, lineNeedsReview, type LineContract, type LineSourceProblem } from "@/lib/isometric/template-observations/line-sources";
import type { TemplateComponent } from "@/lib/isometric/template-observations/types";
import { REMOVAL_TEMPLATE_BLOCKERS } from "./removal-template-blockers";
import { templateRemovalBlocker, type RemovalBlocker } from "./removal-blockers";

export { LINE_NO_MAPPING_MESSAGE } from "@/lib/isometric/emission-line-constants";
export type LineCoverageReason = "unmapped" | "ambiguous" | "project-scope" | "unrecognized-component" | "unassigned";
export interface EmissionLineBindingDecision {
  state: "needsReview" | "needsSetup" | "empty";
  blocker: RemovalBlocker;
  reason: LineCoverageReason;
  inputKeys: string[];
  /** Input keys the catalog does not know. Review cannot add support for them,
   * so coverage reports them as unmapped next to the review finding. */
  unknownInputKeys?: string[];
}

/** Fixed inputs are prebound; sequestration-family inputs compile from Samples
 * and applications. This is the coverage exemption, shared with state
 * derivation and submission. Other stored inputs (legacy carbon content,
 * Safety margin) still need a reviewed contract with an automatic source.
 */
export function lineCompilesWithoutEmissionSource(component: TemplateComponent): boolean {
  return component.inputs.every((input) => input.type === "fixed" ||
    (isSequestrationBlueprintFamily(component.blueprintKey) &&
      (!hasExplicitSequestrationBinding(component.blueprintKey) || !!getSequestrationInputBinding(component.blueprintKey, input.key))));
}

/** Shared capability guard; Removal-specific selection supplies entry values. */
export function emissionLineBindingDecision(args: {
  component: TemplateComponent; groupKey: string; contract?: LineContract;
  problems: readonly LineSourceProblem[]; enrichmentComplete: boolean; entriesCanSubmit?: boolean;
}): EmissionLineBindingDecision | undefined {
  const { component, groupKey, problems } = args;
  const contract = args.contract && effectiveContract(args.contract);
  const inputKeys = component.inputs.filter((input) => input.type === "monitored").map((input) => input.key);
  const keys = inputKeys.length ? inputKeys : [component.inputs[0]?.key ?? ""];
  const lineRef = { componentId: component.id, displayName: component.displayName, inputKey: keys[0] };
  if (!args.enrichmentComplete || lineNeedsReview(component.id, args.contract, problems)) {
    const ambiguous = problems.some((problem) => problem.componentId === component.id && problem.code === "ambiguous");
    const unknownInputKeys = contract && contract.scope !== "unassigned" && !ambiguous
      ? inputKeys.filter((key) => !lookupInputMapping(groupKey, component.blueprintKey, key) &&
        !lookupPeriodInputTuple(groupKey, component.blueprintKey, key) && !getSequestrationInputBinding(component.blueprintKey, key))
      : [];
    const reviewKey = keys.find((key) => !unknownInputKeys.includes(key));
    return {
      state: "needsReview", reason: ambiguous ? "ambiguous" : "unassigned", inputKeys: reviewKey === undefined ? [] : [reviewKey],
      ...(unknownInputKeys.length ? { unknownInputKeys } : {}),
      blocker: args.enrichmentComplete
        ? { code: "lineNeedsReview", message: REMOVAL_TEMPLATE_BLOCKERS.templateLinesNeedReview, fixTarget: "templateLineReview", lineRef }
        : { ...templateRemovalBlocker("templateNotFullyRead"), lineRef },
    };
  }
  if (contract?.scope === "forbidden") return {
    state: "needsSetup", reason: "project-scope", inputKeys: [keys[0]],
    blocker: { ...templateRemovalBlocker("forbiddenLine"), lineRef },
  };
  if (lineCompilesWithoutEmissionSource(component)) return undefined;
  // Legacy paired transport can have a valid automatic contract but no datapoint mapping.
  // Entry capability cannot waive mapping checks for the automatic contribution.
  if (args.entriesCanSubmit && !contract?.automaticSource && contract?.scope === "operating" && contract.entryPolicy !== "none") return undefined;
  const unmappedKeys = component.inputs.filter((input) => input.type === "monitored" &&
    !getSequestrationInputBinding(component.blueprintKey, input.key) &&
    !lookupInputMapping(groupKey, component.blueprintKey, input.key, contract)).map((input) => input.key);
  if (!contract?.automaticSource || unmappedKeys.length) {
    const entryOnly = !contract?.automaticSource && contract?.entryPolicy !== "none";
    return {
      state: entryOnly ? "empty" : "needsSetup", reason: "unmapped", inputKeys: component.blueprintKey === TRANSPORT_BLUEPRINT_KEY ? [keys[0]] : unmappedKeys.length ? unmappedKeys : keys,
      blocker: { code: entryOnly ? "lineHasNoSource" : "lineNeedsSetup", message: component.blueprintKey === TRANSPORT_BLUEPRINT_KEY
        ? LINE_TRANSPORT_REPLACEMENT_MESSAGE
        : LINE_NO_MAPPING_MESSAGE, fixTarget: "templateReplacement", lineRef },
    };
  }
  return undefined;
}
