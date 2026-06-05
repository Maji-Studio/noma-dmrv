const REGISTRY = "https://registry.isometric.com";
const DOCS = "https://docs.isometric.com";

// The supplier's PRIVATE Certify workspace is environment-specific: a sandbox
// submission lives on the sandbox registry host, a production one on the public
// host. (The public registry pages — project/protocol/module below — always
// point at the production host, since the public registry is a single site.)
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
  project: (externalProjectId: string) =>
    `${REGISTRY}/project/${encodeURIComponent(externalProjectId)}`,
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
};

export const isometricDocs = {
  base: DOCS,
  keyConcepts: `${DOCS}/user-guides/certify/key-certify-concepts`,
  componentBlueprints: `${DOCS}/user-guides/certify/component-blueprint-library`,
  removals: `${DOCS}/user-guides/certify/removal`,
  ghgStatements: `${DOCS}/user-guides/certify/ghg-statement`,
  protocolVersioning: `${DOCS}/user-guides/registry/protocol-versioning`,
};
