/**
 * Settings — the organization-configuration console at `/settings`.
 *
 * Org-scoped configuration an Owner/Admin can change lives here. Registry
 * configuration stays at `/certification/settings` (ADR 0007) and cross-tenant
 * platform administration stays at `/admin/organizations`.
 */
export { SettingsConsole } from "./settings-console";
export { OrganizationDefaultsForm } from "./organization-defaults-form";
