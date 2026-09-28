import * as THREE from 'three';
import atlasUrl from './illustrated-sprites.png';
const SIZE = 1254;
// Pixel bounds preserve each hand-drawn silhouette; no runtime background removal.
const REGIONS = [
    [14, 67, 345, 531], [370, 70, 222, 462], [589, 168, 384, 365], [974, 181, 278, 353],
    [18, 612, 330, 377], [364, 549, 275, 442], [676, 552, 174, 435], [862, 667, 390, 321],
    [13, 1014, 354, 230], [374, 1004, 282, 199], [676, 1057, 313, 143], [1020, 1023, 229, 167],
];
let resolveReady: () => void;
export const atlasReady = new Promise<void>(resolve => { resolveReady = resolve; });
const atlas = new THREE.TextureLoader().load(atlasUrl, () => resolveReady());
atlas.colorSpace = THREE.SRGBColorSpace;
atlas.anisotropy = 4;
export function atlasRegion(index: number) { const [x, y, w, h] = REGIONS[index]; const texture = atlas.clone(); texture.repeat.set(w / SIZE, h / SIZE); texture.offset.set(x / SIZE, 1 - (y + h) / SIZE); atlasReady.then(() => { texture.image = atlas.image; texture.needsUpdate = true; }); return texture; }
export function atlasAspect(index: number) { return REGIONS[index][2] / REGIONS[index][3]; }
