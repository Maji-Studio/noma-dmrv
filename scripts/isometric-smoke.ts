/**
 * Phase 0 acceptance: GET /projects against Isometric Certify sandbox.
 *
 * Usage:
 *   pnpm tsx scripts/isometric-smoke.ts
 *
 * Requires ISOMETRIC_CLIENT_SECRET and ISOMETRIC_ACCESS_TOKEN in .env.local.
 * ISOMETRIC_ENVIRONMENT defaults to "sandbox".
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main(): Promise<void> {
  // Defer imports until env is loaded so env.ts validation sees the values.
  const { isometric, IsometricApiError } = await import("../src/lib/isometric");
  const { env } = await import("../src/config/env");
  type Project = import("../src/lib/isometric").components["schemas"]["Project"];
  type ProjectsPage = {
    nodes: Project[];
    page_info: import("../src/lib/isometric").components["schemas"]["PageInfo"];
    total_count: number;
  };

  console.log(`Isometric environment: ${env.ISOMETRIC_ENVIRONMENT}`);

  try {
    const page = await isometric.get<ProjectsPage>("/projects", {
      query: { first: 50 },
    });
    console.log(`total_count: ${page.total_count}`);
    console.log(`returned: ${page.nodes.length}`);
    for (const project of page.nodes) {
      console.log(`  ${project.id}`);
    }
    if (page.page_info.has_next_page) {
      console.log(`(more pages — end_cursor=${page.page_info.end_cursor})`);
    }
  } catch (err) {
    if (err instanceof IsometricApiError) {
      console.error(`IsometricApiError [${err.code ?? "unknown"}]: ${err.message}`);
      if (err.body !== undefined && err.body !== null && err.body !== "") {
        const bodyLength =
          typeof err.body === "string"
            ? err.body.length
            : JSON.stringify(err.body).length;
        console.error(`body_present=true body_length=${bodyLength}`);
      }
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
