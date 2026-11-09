// Local-only assets. The Mafinga photo is gitignored until Dark Earth Carbon approves publishing it (the
// repo is public), so a build from git has no photo; components show a hatched placeholder instead.
// Build-time only (node:fs): import from .astro frontmatter, never from browser scripts.
import { existsSync } from "node:fs";
import { join } from "node:path";

export const MAFINGA_PHOTO = "/images/mafinga-field-trial.jpg";
export const HAS_MAFINGA_PHOTO = existsSync(join(process.cwd(), "public", MAFINGA_PHOTO));

// Film stills from Mafinga, committed (the owner supplied them for the site, 2026-11-09). WebP at two widths,
// 16:9 (1600x900 and 800x450), made from the originals with `cwebp -q 72 -resize <w> 0 -metadata none`.
const still = (name, alt) => ({ src: `/images/photos/mafinga-${name}-1600.webp`, srcset: `/images/photos/mafinga-${name}-800.webp 800w, /images/photos/mafinga-${name}-1600.webp 1600w`, alt, width: 1600, height: 900 });
export const PHOTOS = {
  field: still("field", "Three people talking in a field of dry maize in Mafinga, Tanzania"),
  phone: still("phone", "A hand holding a phone with noma's feedstock list open, beside a pile of wood offcuts"),
  team: still("team", "The Dark Earth Carbon and MAJI team around a screen, going through production records"),
  biochar: still("biochar", "Two people holding biochar from an open sack"),
};
