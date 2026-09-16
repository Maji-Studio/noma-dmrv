/**
 * Shared vocabulary for the CLI bootstrap gates: the admin/organization
 * bootstrap (`src/lib/cli/ensure-admin-core.ts`) and the CLI org-context seam
 * (`src/lib/cli/org-context.ts`) must agree on what "production" means and on
 * the one literal that opts a deliberate run out of the refusal.
 */
export const PRODUCTION_NODE_ENV = "production";
export const DEV_BOOTSTRAP_OVERRIDE = "1";
