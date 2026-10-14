import { ownValue } from "./semantic-binding-catalog";
import {
  projectSequestrationInputBindings,
  type SequestrationBindingTable,
  type SequestrationInputBinding,
} from "./semantic-binding-projections";

/**
 * Explicit component-input bindings for the storage components noma submits:
 * a projection of the semantic binding catalog's measurement-sample roles.
 * Each input declares whether the GHG entry consumes a datapoint returned by a
 * measurement sample or a direct datapoint posted by the removal orchestrator.
 */
export const SEQUESTRATION_COMPONENT_INPUT_BINDINGS: SequestrationBindingTable =
  projectSequestrationInputBindings();

export function hasExplicitSequestrationBinding(
  blueprintKey: string,
): boolean {
  return ownValue(SEQUESTRATION_COMPONENT_INPUT_BINDINGS, blueprintKey) !== undefined;
}

export function getSequestrationInputBinding(
  blueprintKey: string,
  inputKey: string,
): SequestrationInputBinding | null {
  const blueprintBinding = ownValue(SEQUESTRATION_COMPONENT_INPUT_BINDINGS, blueprintKey);
  return (blueprintBinding && ownValue(blueprintBinding.inputs, inputKey)) ?? null;
}

