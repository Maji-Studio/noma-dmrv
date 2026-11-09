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
 |  +------------------+                       |
 |  | Open MRV for     |  "Follow one journey" |
 |  | carbon removal.  |  pins the map; stop   |
 |  | [Book] [Follow]  |  cards scroll and the |
 |  +------------------+  camera dives         |
 +---------------------------------------------+
 ███ STAGE: spreadsheets vs noma (CompareStage) ███
 +--------------+---------------+--------------+
 | Run the plant| Credits issued| Sell w/ proof|   OutcomesSection: three cells,
 | answer art   | answer art    | buyer phone  |   each links to a Product chapter
 +--------------+---------------+--------------+
 |        one line, one big drawing            |   ScaleBlock, TodaySection,
 |        (scale / today / run it)             |   RunItSection: centred big pictures
 +---------------------------------------------+
 | purple-5 band: Get started                  |
 +---------------------------------------------+
```

- **Principles.** Spend the boldness on the stage; keep the light pages quiet. Structure carries meaning
  (dot = a record at a moment, solid line = time spent, dashes = transport). One lit element per stage.
  Content is complete without JS; motion only replays what is already there.

## Components

Each `.astro` file documents its props at the top. Shell: `SiteShell`, `SiteNav`, `SiteFooter`.
Layout: `GridFrame`, `SectionIndex`, `AccordionShowcase` (unused). Actions: `Button`, `TextLink`, `Chip` (unused). Product: `product/ChapterHead` opens each chapter. Home: `home/OutcomesSection`, `home/ScaleBlock`, `home/TodaySection`, `home/RunItSection` (drawings: `home/HomeArt`). Stage: `stage/Stage`,
`stage/StageCheckRow`, `stage/StageConnector`, `stage/StageDot`, `stage/StageMark`. Motion: `motion.js`.
Config (nav, login flag, section anchors): `src/config.js`.
Example data and the trace graph engine: `src/data/` (`core.js` draws the product trace, `data.js` holds the bin
layers). Walkthrough form copy: `src/content/copy.js`. Local-only images (the Mafinga photo, gitignored until Dark
Earth Carbon approves publishing it): `public/images/`, resolved by `src/lib/assets.js`.
Home hero map: `home/HomeHero` + `home/hero-map/` (MapLibre, a port of the app's traceability Map tab). The basemap
is OpenFreeMap Positron and needs no key.
Records: `RecordCard` (+ `record-card.js`, its browser twin, and `record-card.css`): a station drawing, label and
code, one line, what the record holds. Used by the product trace's hover card and the hero map's
record card (text only there); it lays itself out by its own width. Station drawings: `contours/ContourArt` (browser: `contours/index.js`),
also on the hero's stop cards. The SVGs in `contours/` come from `scripts/export-contours.mjs`; don't hand-edit them.
