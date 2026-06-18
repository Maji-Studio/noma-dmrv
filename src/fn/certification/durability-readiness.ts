import { getSamplingMethodsByReactorIds } from "@/data-access/reactors";
import { evaluateDurabilitySubmissionGates } from "@/lib/certification/durability-submission-gates";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";

/**
 * Evaluate the D3 durability gates (eligibility + Method-A-sampled + ≥3
 * replicates) over a removal's runs, reading each run's reactor's CURRENT
 * sampling method (D6; a missing reactor defaults to Method A). The single
 * computation behind BOTH the readiness surfaces and the submit pipeline's hard
 * block — `submitRemoval` throws on this same `durabilityGateBlockers` list, so
 * the pre-flight can never disagree with the gate. Returns [] when there are no
 * runs (nothing to sample yet). Lives outside `certify-context-core` to keep
 * that file under the line cap.
 */
export async function buildDurabilityGateBlockers(
  userId: string,
  runs: ProductionRunWithSamples[],
): Promise<string[]> {
  if (runs.length === 0) return [];
  const reactorIds = [...new Set(runs.map((run) => run.reactorId))];
  const samplingMethodByReactor = await getSamplingMethodsByReactorIds(
    userId,
    reactorIds,
  );
  return evaluateDurabilitySubmissionGates(
    runs.map((run) => ({
      runId: run.id,
      runCode: run.code,
      samplingMethod: samplingMethodByReactor.get(run.reactorId) ?? "method_a",
      replicates: run.samples.map((s) => ({
        hToCOrgRatio: s.hToCOrgRatio,
        oToCOrgRatio: s.oToCOrgRatio,
      })),
    })),
  ).blockers;
}
