// Northern Tanzania DEM, artistically rescaled as continuous rolling terrain.
import sample from './elevation-sample.json';
export const LAND = { width: 180, depth: 160, segmentsX: 256, segmentsZ: 224 };
const MIN_ELEVATION = 687, RELIEF_RANGE = 1777, RELIEF_HEIGHT = 25;
export const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function dem(u: number, v: number) { const x = Math.max(0, Math.min(254.999, u * 255)), z = Math.max(0, Math.min(254.999, v * 255)), ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz; const a = sample.heights[iz * 256 + ix], b = sample.heights[iz * 256 + ix + 1], c = sample.heights[(iz + 1) * 256 + ix], d = sample.heights[(iz + 1) * 256 + ix + 1]; return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz; }
function rawElevation(x: number, z: number) {
    const u = (x + 90) / 180, v = (z + 80) / 160;
    const height = Math.max(0, (dem(u, v) - MIN_ELEVATION) / RELIEF_RANGE) * RELIEF_HEIGHT;
    const edge = 1 - smooth(.69, .97, Math.max(Math.abs(x) / 90, Math.abs(z) / 80));
    return height * .48 * edge;
}
// Match the rendered triangle surface so roads and planting cannot sink between DEM samples.
export function elevation(x: number, z: number) {
    const gx = (x + 90) / 180 * LAND.segmentsX, gz = (z + 80) / 160 * LAND.segmentsZ;
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const sx = LAND.width / LAND.segmentsX, sz = LAND.depth / LAND.segmentsZ;
    const px = ix * sx - 90, pz = iz * sz - 80;
    const a = rawElevation(px, pz), b = rawElevation(px + sx, pz), c = rawElevation(px, pz + sz), d = rawElevation(px + sx, pz + sz);
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
export function siteElevation(x: number, z: number, width: number, depth: number) { let top = 0; for (let i = 0; i <= 4; i++)
    for (let j = 0; j <= 4; j++)
        top = Math.max(top, elevation(x + (i / 4 - .5) * width, z + (j / 4 - .5) * depth)); return top + .025; }
