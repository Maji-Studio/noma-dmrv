/**
 * The Isometric protocol and module versions noma is built against, read from
 * the pin in `docs/isometric/versions.json`. Client-safe: static JSON, no
 * server imports. Bump versions in that file only.
 */
import versions from "../../docs/isometric/versions.json";
import { isometricRegistry } from "@/lib/isometric/links";

export interface IsometricProtocolPin {
  kind: "protocol" | "module";
  slug: string;
  name: string;
  /** Patch version, e.g. 1.1.1. */
  version: string;
  /** Public registry page for the minor version, or null if unparseable. */
  registryUrl: string | null;
}

export const ISOMETRIC_PROTOCOL_PINS: readonly IsometricProtocolPin[] = [
  {
    kind: "protocol",
    slug: versions.protocol.slug,
    name: versions.protocol.name,
    version: versions.protocol.patch_version,
    registryUrl: isometricRegistry.protocol(
      versions.protocol.slug,
      versions.protocol.minor_version,
    ),
  },
  ...versions.modules.map(
    (module): IsometricProtocolPin => ({
      kind: "module",
      slug: module.slug,
      name: module.name,
      version: module.patch_version,
      registryUrl: isometricRegistry.module(module.slug, module.minor_version),
    }),
  ),
];
