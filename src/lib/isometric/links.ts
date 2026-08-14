const REGISTRY = "https://registry.isometric.com";
const DOCS = "https://docs.isometric.com";

// The supplier's PRIVATE Certify workspace is environment-specific: a sandbox
// submission lives on the sandbox registry host, a production one on the public
// host. (The public registry pages — protocol/module below — always point at
// the production host, since the public registry is a single site.)
const CERTIFY_HOSTS = {
  sandbox: "https://registry.sandbox.isometric.com",
  production: REGISTRY,
} as const;

export type IsometricEnvironment = keyof typeof CERTIFY_HOSTS;

const REGISTRY_MINOR_VERSION_PATTERN = /\bv?(\d+\.\d+)(?:\.\d+)?\b/i;

export function normalizeRegistryMinorVersion(version: string): string | null {
  const match = version.trim().match(REGISTRY_MINOR_VERSION_PATTERN);
  return match?.[1] ?? null;
}

export const isometricRegistry = {
  protocol: (slug: string, version: string) => {
    const minorVersion = normalizeRegistryMinorVersion(version);
    if (!minorVersion) return null;
    return `${REGISTRY}/protocol/${encodeURIComponent(slug)}/${encodeURIComponent(minorVersion)}`;
  },
  module: (slug: string, version: string) => {
    const minorVersion = normalizeRegistryMinorVersion(version);
    if (!minorVersion) return null;
    return `${REGISTRY}/module/${encodeURIComponent(slug)}/${encodeURIComponent(minorVersion)}`;
  },
  // The supplier's view of a project is an environment-specific PRIVATE Certify
  // workspace page (NOT the public /project/{id} registry page, which only
  // exists after credit issuance) — it nests under /account/certify on the same
  // host family as removals/statements:
  //   {host}/account/certify/project/{projectId}/overview
  certifyProject: (args: {
    environment: IsometricEnvironment;
    externalProjectId: string;
  }) =>
    `${CERTIFY_HOSTS[args.environment]}/account/certify/project/${encodeURIComponent(
      args.externalProjectId,
    )}/overview`,
  // Storage sites are managed from a project-scoped Certify page. The sites
  // tab must be selected explicitly because the route also hosts other views:
  //   {host}/account/certify/project/{projectId}/storage-sites?tab=sites
  storageSites: (args: {
    environment: IsometricEnvironment;
    externalProjectId: string;
  }) =>
    `${CERTIFY_HOSTS[args.environment]}/account/certify/project/${encodeURIComponent(
      args.externalProjectId,
    )}/storage-sites?tab=sites`,
  // A facility lives in the supplier's private Certify workspace, nested under
  // its project. Verified against a live sandbox URL on 2026-08-04:
  //   {host}/account/certify/project/{projectId}/facilities/{facilityId}
  facility: (args: {
    environment: IsometricEnvironment;
    externalProjectId: string;
    externalFacilityId: string;
  }) =>
    `${CERTIFY_HOSTS[args.environment]}/account/certify/project/${encodeURIComponent(
      args.externalProjectId,
    )}/facilities/${encodeURIComponent(args.externalFacilityId)}`,
  // A submitted removal lives in the supplier's private Certify workspace — it
  // is NOT a public registry page until credit issuance (see
  // docs/isometric — data-visibility). In the Certify UI a removal is a
  // "ghg-entry", nested under its project, on an environment-specific host.
  // Verified against a live sandbox URL on 2026-06-04:
  //   {host}/account/certify/project/{projectId}/ghg-entry/{removalId}/edit
  removal: (args: {
    environment: IsometricEnvironment;
    externalProjectId: string;
    externalRemovalId: string;
  }) =>
    `${CERTIFY_HOSTS[args.environment]}/account/certify/project/${encodeURIComponent(
      args.externalProjectId,
    )}/ghg-entry/${encodeURIComponent(args.externalRemovalId)}/edit`,
  // A production batch lives in the supplier's private Certify workspace,
  // nested under its facility (which nests under the project) — so the link
  // needs all three ids: project, facility, and batch. Verified against a live
  // sandbox URL on 2026-08-05:
  //   {host}/account/certify/project/{prj}/facilities/{fcl}/production-batches/{ptb}
  productionBatch: (args: {
    environment: IsometricEnvironment;
    externalProjectId: string;
    externalFacilityId: string;
    externalProductionBatchId: string;
  }) =>
    `${CERTIFY_HOSTS[args.environment]}/account/certify/project/${encodeURIComponent(
      args.externalProjectId,
    )}/facilities/${encodeURIComponent(
      args.externalFacilityId,
    )}/production-batches/${encodeURIComponent(args.externalProductionBatchId)}`,
  // A GHG statement, like a removal, lives in the supplier's private Certify
  // workspace, nested under its project on an environment-specific host. The
  // path segment is `ghg-statement` (vs the removal's `ghg-entry`), with no
  // `/edit` suffix. Format confirmed against the Isometric MCP on 2026-06-08:
  //   {host}/account/certify/project/{projectId}/ghg-statement/{statementId}
  ghgStatement: (args: {
    environment: IsometricEnvironment;
    externalProjectId: string;
    externalStatementId: string;
  }) =>
    `${CERTIFY_HOSTS[args.environment]}/account/certify/project/${encodeURIComponent(
      args.externalProjectId,
    )}/ghg-statement/${encodeURIComponent(args.externalStatementId)}`,
};

export const isometricDocs = {
  base: DOCS,
  keyConcepts: `${DOCS}/user-guides/certify/key-certify-concepts`,
  componentBlueprints: `${DOCS}/user-guides/certify/component-blueprint-library`,
  removals: `${DOCS}/user-guides/certify/removal`,
  ghgStatements: `${DOCS}/user-guides/certify/ghg-statement`,
  protocolVersioning: `${DOCS}/user-guides/registry/protocol-versioning`,
};
