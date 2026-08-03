import type { RemovalSourceBindingPlanEntry } from "@/lib/certification/removal-source-bindings";
import type { IsometricClient } from "./client";
import {
  getComponent,
  getDatapoint,
  listGhgEntryComponentAttributions,
} from "./submissions";

export interface SourceBindingMismatch {
  sourceId: string;
  nomaRole: RemovalSourceBindingPlanEntry["nomaRole"];
  reason: string;
}

export type RemovalSourceBindingVerification =
  | {
      state: "verified";
      verifiedCount: number;
      totalCount: number;
      mismatches: [];
    }
  | {
      state: "awaiting_sync";
      verifiedCount: number;
      totalCount: number;
      mismatches: [];
      awaitingTargets: string[];
    }
  | {
      state: "mismatch";
      verifiedCount: number;
      totalCount: number;
      mismatches: SourceBindingMismatch[];
    };

function datapointIdsForInput(
  input:
    | {
        __typename: "ComponentScalarInput";
        datapoint_id: string;
      }
    | {
        __typename: "ComponentListInput";
        datapoint_ids: string[];
      },
): string[] {
  return input.__typename === "ComponentScalarInput"
    ? [input.datapoint_id]
    : input.datapoint_ids;
}

/**
 * Proves each immutable plan entry through the GHG Entry's attributed
 * component and intended input. Merely finding the Source is never success.
 */
export async function verifyRemovalSourceBindings(
  client: IsometricClient,
  ghgEntryId: string,
  plan: RemovalSourceBindingPlanEntry[],
): Promise<RemovalSourceBindingVerification> {
  const attributions = await listGhgEntryComponentAttributions(
    client,
    ghgEntryId,
  );
  const componentById = new Map<
    string,
    Awaited<ReturnType<typeof getComponent>>
  >();
  const datapointById = new Map<
    string,
    Awaited<ReturnType<typeof getDatapoint>>
  >();
  const mismatches: SourceBindingMismatch[] = [];
  const awaitingTargets: string[] = [];
  let verifiedCount = 0;

  for (const entry of plan) {
    const target = entry.intendedTarget;
    const attribution = attributions.find(
      (candidate) =>
        candidate.component_group_key === target.groupKey &&
        candidate.ghg_entry_template_component_id === target.componentId,
    );
    if (!attribution) {
      awaitingTargets.push(`${target.componentId}::${target.inputKey}`);
      continue;
    }

    let component = componentById.get(attribution.component_id);
    if (!component) {
      component = await getComponent(client, attribution.component_id);
      componentById.set(attribution.component_id, component);
    }
    const input = component.inputs.find(
      (candidate) => candidate.input_key === target.inputKey,
    );
    if (!input) {
      mismatches.push({
        sourceId: entry.sourceId,
        nomaRole: entry.nomaRole,
        reason: `Attributed component ${component.id} has no intended input "${target.inputKey}".`,
      });
      continue;
    }
    const datapointIds = datapointIdsForInput(input);
    if (datapointIds.length === 0) {
      mismatches.push({
        sourceId: entry.sourceId,
        nomaRole: entry.nomaRole,
        reason: `Attributed component ${component.id} has no Datapoint on intended input "${target.inputKey}".`,
      });
      continue;
    }

    let sourceVerified = false;
    for (const datapointId of datapointIds) {
      let datapoint = datapointById.get(datapointId);
      if (!datapoint) {
        datapoint = await getDatapoint(client, datapointId);
        datapointById.set(datapointId, datapoint);
      }
      if (datapoint.source_ids.includes(entry.sourceId)) {
        sourceVerified = true;
        break;
      }
    }
    if (sourceVerified) {
      verifiedCount += 1;
    } else {
      mismatches.push({
        sourceId: entry.sourceId,
        nomaRole: entry.nomaRole,
        reason: `Source is absent from the intended Datapoint target "${target.componentId}::${target.inputKey}".`,
      });
    }
  }

  if (mismatches.length > 0) {
    return {
      state: "mismatch",
      verifiedCount,
      totalCount: plan.length,
      mismatches,
    };
  }
  if (awaitingTargets.length > 0) {
    return {
      state: "awaiting_sync",
      verifiedCount,
      totalCount: plan.length,
      mismatches: [],
      awaitingTargets,
    };
  }
  return {
    state: "verified",
    verifiedCount,
    totalCount: plan.length,
    mismatches: [],
  };
}
