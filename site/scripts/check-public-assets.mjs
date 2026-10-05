// Fails when site/src references a root-relative file ("/brand/x.svg") that site/public
// does not contain. Astro builds such a page without complaint and the browser shows a
// broken image. Run from site/: `pnpm check:assets`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { MAFINGA_PHOTO } from "../src/lib/assets.js";

const SRC = "src";
const PUBLIC = "public";
const SOURCE_EXTENSIONS = /\.(astro|js|mjs|ts|css|md)$/;
const ASSET_EXTENSIONS = "svg|png|jpe?g|webp|avif|gif|ico|mp4|webm|woff2?|ttf|json|geojson|pdf|txt|xml";
// A quoted string or url(...) holding a root-relative path that ends in an asset extension.
const ASSET_REF = new RegExp(`["'\`(](/[A-Za-z0-9_./-]+\\.(?:${ASSET_EXTENSIONS}))(?=["'\`)?#])`, "g");
// Gitignored on purpose (docs/site.md): components check HAS_MAFINGA_PHOTO and draw a placeholder.
const PRIVATE_ASSETS = new Set([MAFINGA_PHOTO]);

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (SOURCE_EXTENSIONS.test(name)) yield path;
  }
}

const missing = [];
let checked = 0;
for (const file of sourceFiles(SRC)) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    for (const [, assetPath] of line.matchAll(ASSET_REF)) {
      checked += 1;
      if (PRIVATE_ASSETS.has(assetPath)) continue;
      if (!existsSync(join(PUBLIC, assetPath))) missing.push(`${relative(".", file)}:${index + 1} ${assetPath}`);
    }
  });
}

if (missing.length > 0) {
  console.error(`Missing from site/public (${missing.length}):\n${missing.map((m) => `  ${m}`).join("\n")}`);
  process.exit(1);
}
console.log(`check:assets: ${checked} root-relative asset references, all present.`);
