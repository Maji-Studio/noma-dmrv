# Biochar Landscape Atlas

An independent React Three Fiber / Three.js prototype for reviewing the six-step biochar process. It builds a single offline HTML with all code, fonts, lighting and artwork embedded. It is separate from the Next.js application and uses no authentication, database or API.

## Run and review

From the repository root:

```sh
pnpm --dir prototypes/biochar-landscape install --frozen-lockfile
pnpm --dir prototypes/biochar-landscape check
pnpm prototype:biochar
```

Open http://localhost:3190/ or open the generated `index.html` directly in a WebGL-capable browser. The generated HTML is about 14.5 MB and is ignored by Git; source assets and lighting bakes are versioned. Rebuild after edits and reload the browser. The preview serves the file without a watcher.

Choose **Scene composition** below the introduction:

| Query parameter | Composition |
| --- | --- |
| `composition=atlas` | Original open landscape and detailed process models (default). |
| `composition=circle` | Circular lane, crescent pavilion, arched gantries, planted commons and curved crop terraces. |
| `composition=campus` | Shared workyards, sawtooth shed, recovery silo, open gabled mixing frames and oval crop beds. |

Example: http://localhost:3190/?variant=A&palette=natural&shading=simple&composition=circle

**View settings** contains independent palette and shading selectors, labels and motion controls. The five shading finishes are `simple`, `wire`, `hybrid`, `clay` and `print`; `original` preserves the previous illustration treatment. See [Shading studies](SHADING-STUDIES.md) for techniques and research. Composition changes reload the scene with its matching bake and preserve the palette/shading URL parameters.

Select a station to focus, use Next stage to move through the process, and Overview to fit the landscape. Drag to orbit and scroll/pinch to zoom. Escape closes settings, exits presentation or restores the overview. Reduced-motion preferences disable camera interpolation and ambient motion. All stations retain full palette colours; selecting one never fades the others.

## Where to edit

| Change | Source |
| --- | --- |
| Station placement, truck orientation, lane paths | `src/composition-state.ts` |
| Process descriptions, labels and height placement | `src/process-data.ts` |
| Alternative station forms and central gardens | `src/remodelled-models.ts` |
| Original storage and trucks | `src/model-logistics.ts` |
| Original reactor and mixing machinery | `src/model-production.ts` |
| Tractor, crops and original root section | `src/model-farm.ts` |
| Model selection and material batching | `src/static-models.ts`, `src/optimize-model.ts` |
| Grounded foundations and terrain-following crop beds | `src/site-foundations.ts` |
| Tree placement and simple instanced tree forms | `src/model-ecology.ts`, `src/botanical-sprites.ts` |
| Terrain surface, roads and elevation | `src/terrain.ts`, `src/terrain-height.ts` |
| Palette definitions and shader application | `src/colour-studies.ts`, `src/palette-study.tsx` |
| Shading modes and station pigment preservation | `src/shading-state.ts`, `src/shading-treatment.tsx`, `src/station-materials.ts` |
| Lighting and baked visibility | `src/miniature-lighting.tsx`, `src/baked-model-lighting.tsx`, `src/sketch-material.ts` |
| Camera travel | `src/camera-rig.tsx` |
| Clouds, ground details, material flow and fire | `src/landscape-atmosphere.tsx`, `src/landscape-life.tsx`, `src/reactor-fire.tsx` |
| Interface and scene assembly | `src/main.tsx`, `src/styles.css`, `src/landscape-scene.tsx` |

Keep geometry factories independent of React. Scene composition is selected once at load, shared by the browser and offline baker. Keep station positions in the composition configuration rather than duplicating world coordinates in visual effects. Use `model-kit.ts` pigments and modelling helpers for new solids so batching, palette mapping and baked visibility stay compatible.

## Rebuild lighting after geometry changes

Changing a static model, its position/orientation, foundations or common garden requires rebaking that composition:

```sh
pnpm --dir prototypes/biochar-landscape bake:models atlas
pnpm --dir prototypes/biochar-landscape bake:models circle
pnpm --dir prototypes/biochar-landscape bake:models campus
pnpm --dir prototypes/biochar-landscape check
```

Terrain/elevation or sun-direction changes require `pnpm --dir prototypes/biochar-landscape bake:all`, then `check`. Keep the sun directions in the lighting and bake scripts consistent. Palette, UI and shading changes do not require new geometry bakes.

The original composition has 52 merged static meshes; each new composition has 48. Every composition owns its vertex AO/sun visibility and 512 × 512 ground visibility map. The unchanged terrain has a separate offline bake. `verify` validates mesh counts and visibility-array dimensions for all three compositions; it does **not** detect geometry changes that retain the same vertex counts, so rebaking is still required after edits.

Baking uses 12 hemisphere samples and directional visibility, not a full path-traced GI solution. The HDR supplies environment illumination. Trees have static, terrain-following directional silhouette shadows; animated fire and clouds are excluded from static bakes. Model geometry is batched, trees are instanced, pixel ratio is capped, and ambient motion uses a pausable 24 Hz demand-render clock. No runtime AO/ray-tracing pass is added.

## Assets and portability

- Official MAJI logo: `src/maji-logo.svg`, supplied design-system asset.
- GT Flexa fonts: embedded at build time from the repository's `src/styles/fonts` directory.
- Sunset environment: `src/sunset.hdr`, supplied local Zürich miniature reference. City-specific lightmaps are not reused.
- `src/illustrated-sprites.png`: generated botanical/cloud atlas from this design exploration. Trees now use geometry; clouds still use the atlas.
- `src/elevation-sample.json`: Mapzen/Tilezen Terrarium tile `10/613/521`, northern Tanzania, artistically rescaled. This is an explanatory landscape, not a surveyed site plan.

The prototype package and lockfile are isolated from the application. Main-app TypeScript and ESLint exclude this directory; run the prototype's `check` command explicitly. Generated HTML and `node_modules` stay local.

## Verification limits

The standalone build, prototype TypeScript check and all three geometry/bake checks pass. Desktop browser checks covered both remodelled overviews, composition switching, station navigation, wire shading and full-colour station preservation without console errors. Narrow-screen verification was interrupted by a browser debugger timeout. Physical mobile performance and reduced-motion OS toggling have not been measured.
