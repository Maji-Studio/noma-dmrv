const REGISTRY = "https://registry.isometric.com";
const DOCS = "https://docs.isometric.com";

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
};

export const isometricDocs = {
  base: DOCS,
  keyConcepts: `${DOCS}/user-guides/certify/key-certify-concepts`,
  componentBlueprints: `${DOCS}/user-guides/certify/component-blueprint-library`,
  removals: `${DOCS}/user-guides/certify/removal`,
  ghgStatements: `${DOCS}/user-guides/certify/ghg-statement`,
  protocolVersioning: `${DOCS}/user-guides/registry/protocol-versioning`,
};
