/** One-off activation cleanup. Uses the supplied process environment; dry-run by default. */
import { parseRetirementOptions, runSampleTransportRetirement } from "./retire-sample-transport-core";
import { CliBootstrapError } from "./org-context";
import { SafeError } from "@/lib/errors";

async function main() {
  const options = parseRetirementOptions(process.argv.slice(2));
  const { resolveCliAdminIdentity, runWithCliOrgContext } = await import("./org-context");
  const { requireOrgContext } = await import("@/lib/auth/server");
  const { requireEmissionsEntriesEnabled } = await import("@/lib/certification/emissions-entry-gate");
  const { listSampleTransportRetirementCandidates, deleteSampleTransportLegForRetirement } = await import("@/data-access/sample-transport-retirement");
  if (options.delete) requireEmissionsEntriesEnabled();
  const identity = await resolveCliAdminIdentity(options.organizationId);
  await runWithCliOrgContext(identity, async () => {
    const ctx = await requireOrgContext();
    await runSampleTransportRetirement(options, {
      list: () => listSampleTransportRetirementCandidates(ctx),
      remove: (id, version) => deleteSampleTransportLegForRetirement(ctx, id, version),
      log: (counts) => console.log(JSON.stringify(counts)),
    });
  });
}

main().then(() => process.exit(0), (error: unknown) => {
  // Database errors can embed parameters. Keep failure output independent of them.
  console.error(error instanceof CliBootstrapError || error instanceof SafeError ? error.message
    : "Sample transport retirement failed; no further legs were deleted. Check the gate, CLI identity, lineage locks and evidence references, then rerun the dry-run.");
  process.exit(1);
});
