import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const PERMANENT_REDIRECT_STATUS = 308;
const HOSTS = [
  { site: "noma.maji.studio", app: "app.noma.maji.studio" },
  { site: "staging.noma.maji.studio", app: "staging.app.noma.maji.studio" },
];
const EXCLUDED_APP_SEGMENTS = [
  // /e2e/map-smoke is a test fixture that returns 404 in real production builds.
  "e2e",
];

type RouteParams = Record<string, string | string[]>;

interface Redirect {
  source: string;
  destination: string;
  statusCode: number;
  has?: { type: string; value: string }[];
}

interface PathToRegexp {
  match: (source: string) => (path: string) => false | { params: RouteParams };
  compile: (destination: string) => (params: RouteParams) => string;
}

// Next vendors the Vercel-compatible parser; no extra dependency or custom regex
// translation is needed. The standalone path-to-regexp package is not resolvable.
const require = createRequire(import.meta.url);
const { match, compile } = require(
  require.resolve("next/dist/compiled/path-to-regexp"),
) as PathToRegexp;

const { redirects } = JSON.parse(
  readFileSync(resolve(ROOT, "vercel.json"), "utf8"),
) as { redirects: Redirect[] };

function appSegments(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    // Files such as page.tsx, layout.tsx, globals.css and icon.svg are not segments.
    if (!entry.isDirectory() || entry.name.startsWith("_")) return [];
    // Route groups do not contribute a URL segment, including nested groups.
    if (entry.name.startsWith("(") && entry.name.endsWith(")")) {
      return appSegments(join(directory, entry.name));
    }
    return [entry.name];
  });
}

function sitePagePaths(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return sitePagePaths(join(directory, entry.name), `${prefix}/${entry.name}`);
    }
    if (!entry.name.endsWith(".astro")) return [];
    const segment = entry.name.slice(0, -".astro".length);
    return [segment === "index" ? prefix || "/" : `${prefix}/${segment}`];
  });
}

function topLevelDirectories(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// The app's public folders are app paths too (old emails embed /email/*.png).
// A folder the site also serves, such as /brand, stays on the site.
const sitePublicDirectories = topLevelDirectories(resolve(ROOT, "site/public"));
const appPublicSegments = topLevelDirectories(resolve(ROOT, "public"))
  .filter((directory) => !sitePublicDirectories.includes(directory));

const segments = [...new Set([...appSegments(resolve(ROOT, "src/app")), ...appPublicSegments])]
  .filter((segment) => !EXCLUDED_APP_SEGMENTS.includes(segment))
  .sort();

const untouchedPaths = [...new Set([
  "/",
  ...sitePagePaths(resolve(ROOT, "site/src/pages")),
  "/_astro/x.js",
  "/brand/x.svg",
  "/favicon.svg",
  "/not-a-route",
  "/login-extra",
  "/xwell-known",
  ...EXCLUDED_APP_SEGMENTS.flatMap((segment) => [`/${segment}`, `/${segment}/x/y`]),
])];

const compiledRedirects = redirects.map((redirect) => {
  const destination = new URL(redirect.destination);
  return {
    ...redirect,
    matchSource: match(redirect.source),
    // Compile the destination path separately so the URL scheme's colon is literal.
    destinationOrigin: destination.origin,
    compileDestination: compile(destination.pathname),
  };
});

function redirectsFor(host: string, path: string) {
  return compiledRedirects.flatMap((redirect) => {
    // Vercel treats a `has` value as a regular expression against the whole host.
    const matchesHost = redirect.has?.every(
      (condition) => condition.type === "host" && new RegExp(`^(?:${condition.value})$`).test(host),
    ) ?? true;
    if (!matchesHost) return [];
    const matched = redirect.matchSource(path);
    if (!matched) return [];
    return [{
      destination: redirect.destinationOrigin + redirect.compileDestination(matched.params),
      statusCode: redirect.statusCode,
    }];
  });
}

describe("site host redirects for old app links", () => {
  it("has app segments to check and only host-scoped 308 redirects without query strings", () => {
    expect(segments.length).toBeGreaterThan(0);
    expect(redirects).toHaveLength(HOSTS.length);
    for (const { site, app } of HOSTS) {
      const rules = redirects.filter((redirect) =>
        redirect.has?.some((condition) => condition.type === "host" && new RegExp(condition.value).test(site)),
      );
      expect(rules).toHaveLength(1);
      // Anchored and escaped, so noma.maji.studio never matches staging.noma.maji.studio.
      expect(rules[0].has).toEqual([{ type: "host", value: `^${site.replaceAll(".", "\\.")}$` }]);
      expect(rules[0].statusCode).toBe(PERMANENT_REDIRECT_STATUS);
      const destination = new URL(rules[0].destination);
      expect(destination.origin).toBe(`https://${app}`);
      expect(destination.search).toBe("");
      expect(destination.hash).toBe("");
    }
  });

  describe.each(HOSTS)("$site", ({ site, app }) => {
    it.each(segments)("redirects /%s and its subpaths to the app host", (segment) => {
      for (const path of [`/${segment}`, `/${segment}/x/y`]) {
        expect(redirectsFor(site, path), `${site}${path}`).toEqual([{
          destination: `https://${app}${path}`,
          statusCode: PERMANENT_REDIRECT_STATUS,
        }]);
      }
    });

    it.each(untouchedPaths)("leaves %s on the site", (path) => {
      expect(redirectsFor(site, path)).toEqual([]);
    });
  });

  it.each([...HOSTS.map(({ app }) => app), "other.noma.maji.studio"])(
    "does not redirect app links on %s",
    (host) => {
      for (const segment of segments) {
        for (const path of [`/${segment}`, `/${segment}/x/y`]) {
          expect(redirectsFor(host, path)).toEqual([]);
        }
      }
    },
  );
});
