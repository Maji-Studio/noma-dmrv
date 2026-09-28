import type { Vector3Tuple } from 'three';
export const COMPOSITIONS = {
    atlas: { name: 'Original atlas', note: 'The original open landscape and detailed process models.' },
    circle: { name: 'Circular journey', note: 'Six stations around a planted commons, connected by a continuous lane.' },
    campus: { name: 'Working campus', note: 'Shared workyards, distinctive roof forms and a productive garden.' },
};
export type Composition = keyof typeof COMPOSITIONS;
// The offline baker supplies the same selection before importing any geometry.
const supplied = (globalThis as typeof globalThis & {
    __landscapeComposition?: string;
}).__landscapeComposition;
const requested = typeof location === 'undefined' ? supplied : new URLSearchParams(location.search).get('composition');
export const COMPOSITION: Composition = requested && requested in COMPOSITIONS ? requested as Composition : 'atlas';
export const REMODELLED = COMPOSITION !== 'atlas';
export const STATION_LAYOUTS: Record<Composition, number[][]> = {
    atlas: [[-28, -12], [-13, -3], [-1, -8], [17, 0], [12, 18], [-15, 28]],
    circle: [[-34, -8], [-18, -20], [10, -34], [34, -4], [18, 20], [-12, 32]],
    campus: [[-25, -20], [-26, 2], [-3, -20], [18, -16], [25, 6], [5, 29]],
};
export const STATION_YAWS: Record<Composition, number[]> = { atlas: [0, 0, 0, 0, Math.PI, 0], circle: [0, .73, 0, 0, -2.41, 0], campus: [0, -Math.PI / 2, 0, 0, Math.PI / 2, 0] };
const circularLane = Array.from({ length: 25 }, (_, i): Vector3Tuple => { const angle = -Math.PI + i / 24 * Math.PI * 2; return [Math.cos(angle) * 27, 0, Math.sin(angle) * 27]; });
export const ROUTE_POINTS: Vector3Tuple[][] = COMPOSITION === 'circle' ? [circularLane] : COMPOSITION === 'campus' ? [
    [[-26, 0, -9], [-26, 0, 2], [-23, 0, 10], [0, 0, 10], [25, 0, 10], [25, 0, 6], [26, 0, -5]],
    [[0, 0, 10], [0, 0, 17], [5, 0, 20]],
] : [
    [[-36, 0, -3], [-23, 0, -3], [-13, 0, -3], [-6, 0, -3], [2, 0, -3]],
    [[19, 0, 6], [27, 0, 7], [27, 0, 18], [12, 0, 18], [-15, 0, 18], [-15, 0, 22]],
];
export const SITE_SIZES = REMODELLED ? [[17, 15], [12, 6], [17, 13], [15, 13], [12, 6], [24, 18]] : [[14, 11], [0, 0], [14, 8], [12, 10], [0, 0], [22, 15]];
