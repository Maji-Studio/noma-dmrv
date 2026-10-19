// Local-only assets. The Mafinga photo is gitignored until Dark Earth Carbon approves publishing it (the
// repo is public), so a build from git has no photo; components show a hatched placeholder instead.
// Build-time only (node:fs): import from .astro frontmatter, never from browser scripts.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const MAFINGA_PHOTO = "/images/mafinga-field-trial.jpg";
export const HAS_MAFINGA_PHOTO = existsSync(join(process.cwd(), "public", MAFINGA_PHOTO));
