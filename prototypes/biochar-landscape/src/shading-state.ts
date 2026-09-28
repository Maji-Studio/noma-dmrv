export const SHADING_STUDIES = {
    original: { id: 0, name: 'Current illustration', note: 'The existing natural landscape and baked lighting.' },
    simple: { id: 1, name: '01 · Simple forms', note: 'Flat colour masses and a restrained two-tone light.' },
    wire: { id: 2, name: '02 · Wire drawing', note: 'A light architectural study with visible structural linework.' },
    hybrid: { id: 3, name: '03 · Colour & wire', note: 'Matte model colours with fine architectural edges.' },
    clay: { id: 4, name: '04 · Clay miniature', note: 'Porcelain surfaces shaped by ambient occlusion and sunlight.' },
    print: { id: 5, name: '05 · Stipple print', note: 'A limited ink palette with shadow-weighted stippling.' },
};
export type ShadingMode = keyof typeof SHADING_STUDIES;
export const SHADING_UNIFORMS = { uShadingMode: { value: 0 } };
export function readShading(): ShadingMode { const key = new URLSearchParams(location.search).get('shading'); return key && key in SHADING_STUDIES ? key as ShadingMode : 'simple'; }
