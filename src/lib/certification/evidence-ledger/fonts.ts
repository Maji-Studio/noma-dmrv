/**
 * Registers the bundled DM Sans / DM Mono TTFs with react-pdf.
 *
 * The TTFs live alongside this module (./fonts/*.ttf) and are read by absolute
 * path at render time. `process.cwd()` is the repo root both under `pnpm dev`
 * and `next start`; for the Vercel serverless bundle these files must be traced
 * via `outputFileTracingIncludes` in next.config (deploy step — see
 * docs/open-questions.md). Registration is idempotent so repeated renders in a
 * warm Fluid instance don't re-register.
 */
import path from "node:path";
import { Font } from "@react-pdf/renderer";

const FONT_DIR = path.join(
  process.cwd(),
  "src/lib/certification/evidence-ledger/fonts",
);

let registered = false;

export function registerEvidenceLedgerFonts(): void {
  if (registered) return;

  Font.register({
    family: "DM Sans",
    fonts: [
      { src: path.join(FONT_DIR, "DMSans-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "DMSans-Medium.ttf"), fontWeight: 500 },
      { src: path.join(FONT_DIR, "DMSans-SemiBold.ttf"), fontWeight: 600 },
      { src: path.join(FONT_DIR, "DMSans-Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.register({
    family: "DM Mono",
    fonts: [
      { src: path.join(FONT_DIR, "DMMono-Regular.ttf"), fontWeight: 400 },
      { src: path.join(FONT_DIR, "DMMono-Medium.ttf"), fontWeight: 500 },
    ],
  });

  // The ledger has long org names and GPS strings; the default hyphenation
  // callback would insert soft hyphens mid-token. Disable it so wrapping
  // happens on whitespace only (matches the HTML mockup's word-wrap).
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}
