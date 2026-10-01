# Site components (marketing site)

Light editorial pages with one dark keynote stage per page. Brief: owner's 2026-09-30 build brief.

## Plan

- **Colour.** Page `#fff2f7` (`--page`), ink `#0f021a`, purple `#480b73` (CTA, links), rose `#ffb2d2` (the lit
  accent on stages), hairlines purple-20. Stages are `--stage` (`#0f021a`), never neutral grey.
- **Type.** GT Flexa Light 300 for every heading, tracked tight (`--track-display`). Bold only for the wordmark.
  Body Light 18px, lead 22px, measure 52ch. GT Flexa Mono uppercase appears only inside stage diagrams.
- **Layout.** A 1240px column framed by two hairlines; every section adds a top rule, and a small cross marks
  each place a rule meets the frame. Content left-aligned, headline and lead as a tight pair. Stages break out
  full-bleed; the frame lines carry through them, dimmed.

```text
 +---------------------------------------------+
 | map of one operation, full bleed            |
 |  +------------------+    [> Follow one      |
 |  | Trace your       |       delivery]       |
 |  | biochar, ...     |   entered: map pins,  |
 |  +------------------+   8 stop cards scroll |
 |                          and the camera dives|
 +---------------------------------------------+
 ███ STAGE: huge line, then a dot-and-dash timeline ███
 +--------------+------------------------------+
 | heading      |   + - - - - - - - - - - +    |   AccordionShowcase: accordion left,
 | > open item  |   | hatched frame,      |    |   one visual right that swaps with
 |   closed     |   | the open item's     |    |   the open item
 |   closed     |   + visual  - - - - - - +    |
 +--------------+------------------------------+
 | photo                | Built with producers |
 +---------------------------------------------+
 | rose band: Upcoming teaser                  |
 | open-source line                            |
 | purple-5 band: Get started                  |
 +---------------------------------------------+
```

- **Principles.** Spend the boldness on the stage; keep the light pages quiet. Structure carries meaning
  (dot = a record at a moment, solid line = time spent, dashes = transport). One lit element per stage.
  Content is complete without JS; motion only replays what is already there.

## Components

Each `.astro` file documents its props at the top. Shell: `SiteShell`, `SiteNav`, `SiteFooter`.
Layout: `GridFrame`, `SectionIndex`, `AccordionShowcase` (Home tour, Product "What's next"). Actions: `Button`, `TextLink`, `Chip`. Stage: `stage/Stage`,
`stage/StageCheckRow`, `stage/StageConnector`, `stage/StageDot`, `stage/StageMark`. Motion: `motion.js`.
Config (nav, login flag, section anchors): `src/config.js`.
Home hero map: `home/HomeHero` + `home/hero-map/` (MapLibre, a port of the app's traceability Map tab). The basemap
needs `PUBLIC_MAPTILER_KEY` (the app's domain-locked MapTiler key; `.env.local` locally, a Vercel env var on the site
project, with noma.maji.studio allowed on the key). Without it the sites plot on a dotted field.
Records: `RecordCard` (+ `record-card.js`, its browser twin, and `record-card.css`): a station drawing, label and
code, one line, what the record holds. Used by `TraceStage`, the product trace's hover card and the hero map's
record card (text only there); it lays itself out by its own width. Station drawings: `contours/ContourArt` (browser: `contours/index.js`),
also on the hero's stop cards. The SVGs in `contours/` come from `scripts/export-contours.mjs`; don't hand-edit them.
