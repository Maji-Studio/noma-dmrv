import { payloadHash } from "@/lib/isometric/utils/payload-hash";
import { compareIds } from "@/lib/isometric/template-observations/normalize";
import type { RemovalTemplateSetupPlan, SetupOption } from "./removal-template-setup-plan";

/** Hash choices and settled contracts, independent of observation IDs and display metadata. */
export function setupPlanFingerprint(plan: RemovalTemplateSetupPlan): string {
  const options = (values: SetupOption[]) => [...values].sort((a, b) => compareIds(a.id, b.id))
    .map(({ id, assignments }) => ({ id, assignments }));
  return payloadHash({
    decided: plan.decided.map(({ component, contract }) => ({ id: component.id, contract: contract && {
      scope: contract.scope, automaticSource: contract.automaticSource, entryPolicy: contract.entryPolicy,
    } })).sort((a, b) => compareIds(a.id, b.id)),
    defaults: plan.defaults.map(({ component, proposal, options: values }) => ({
      id: component.id, proposal: proposal.id, options: options(values),
    })).sort((a, b) => compareIds(a.id, b.id)),
    decisions: plan.decisions.map(({ id, kind, components, options: values }) => ({
      id, kind, componentIds: components.map(({ component }) => component.id).sort(compareIds), options: options(values),
    })).sort((a, b) => compareIds(a.id, b.id)),
  });
}
