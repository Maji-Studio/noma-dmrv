# Landscape Atlas shading studies

Five shader treatments share the same models, camera, layout and palette controls. `shading=original` preserves the previous illustrated landscape. The study query parameter works in both the local preview and the self-contained HTML.

| Study | Query | Visual intent |
| --- | --- | --- |
| Simple forms | `shading=simple` | Broad, simplified colour masses and two-tone light. |
| Wire drawing | `shading=wire` | Architectural linework over pale depth-preserving surfaces. |
| Colour & wire | `shading=hybrid` | Solid pigments combined with restrained structural edges. |
| Clay miniature | `shading=clay` | Neutral porcelain surfaces shaped by existing ambient occlusion and sun visibility. |
| Stipple print | `shading=print` | A limited sage/cream ink treatment with filtered shadow-weighted dots. |

Change shading in **View settings → Shading studies**. Colour palettes remain independently selectable. Switching a study should preserve the current camera and stage, so comparisons are meaningful. Hover and selection remain available in each treatment.

All six stations and the farm root section retain their full palette colours in every study. Clay and wire neutralisation apply to surroundings only; station stippling shades the original pigments. Selecting or hovering a station never fades or recolours other stations. The rose focus grid, labels and camera identify the active section without reducing model contrast.

## Research informing the implementation

- [Three.js EdgesGeometry](https://threejs.org/docs/pages/EdgesGeometry.html) selects creases through an angle threshold rather than displaying every coplanar triangulation seam. Reusing prepared geometry avoids per-frame edge extraction.
- [Three.js MeshToonMaterial](https://threejs.org/docs/pages/MeshToonMaterial.html) documents stepped lighting gradients. The prototype adapts the lighting in its existing material hooks to retain its custom baked data.
- [Catlike Coding: Flat and Wireframe Shading](https://catlikecoding.com/unity/tutorials/advanced-rendering/flat-and-wireframe-shading/) explains barycentric edges and why derivatives must be evaluated before reducing edge distances.
- [Ben Golus: The Best Darn Grid Shader (Yet)](https://bgolus.medium.com/the-best-darn-grid-shader-yet-727f9278b9d8) describes derivative-aware line widths and subpixel filtering to avoid shimmering patterns.
- [Praun et al., Real-Time Hatching, SIGGRAPH 2001](https://gfx.cs.princeton.edu/proj/hatching/) motivates coherence across scale and tone. The print mode uses deterministic spatial patterns rather than animated random noise; it is not an implementation of the paper's tonal art maps.
- [Three.js Material](https://threejs.org/docs/pages/Material.html) documents shader customisation and cache keys. Existing palette, AO and stage-emphasis hooks must remain chained.

These are original procedural treatments inspired by the techniques above. No external shader asset is loaded by the finished HTML.

## Verification and performance scope

The standalone build and TypeScript check pass. Browser checks covered all five treatments, stage selection, camera transitions and switching finishes without losing the selected stage. Final clay and print refinements were checked in a reactor close-up; the browser reported no shader errors or warnings.

Structural model edges are prepared once and cached. Tree linework uses precomputed barycentric attributes; terrain and print patterns use derivative filtering. The existing AO/sun bake and demand-rendering clock remain in use, with no additional postprocessing or real-time AO pass. Physical mobile-device frame rates have not been benchmarked.
