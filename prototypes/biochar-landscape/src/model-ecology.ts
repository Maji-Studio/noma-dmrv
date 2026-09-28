import { COMPOSITION, REMODELLED, STATION_LAYOUTS, ROUTE_POINTS, SITE_SIZES } from './composition-state';
import { createBotanicalSprites } from './botanical-sprites';
import * as THREE from 'three';
const ECOLOGY = { seed: 48179, count: 182, maximumAttempts: 10000, minimumSpacing: 1.6, roadClearance: 3.1 };
// Soft elliptical clearances protect landmarks without creating a rectangular woodland border.
const SITES = REMODELLED ? STATION_LAYOUTS[COMPOSITION].map(([x, z], i) => [x, z, SITE_SIZES[i][0] * .75, SITE_SIZES[i][1] * .75]) : [[-28, -12, 11, 10], [-13, -3, 8, 5], [-1, -8, 10, 8], [17, 0, 9, 8], [12, 18, 8, 5], [-15, 28, 16, 12], [33, -12, 8, 7]];
const GROVES = [[-39, -28, 10, 13], [-12, -41, 15, 9], [25, -32, 13, 10], [45, -5, 12, 16], [-43, 9, 12, 13], [-34, 38, 10, 11], [14, 40, 15, 10], [43, 32, 12, 13], [2, 8, 8, 6]];
const ROUTES = ROUTE_POINTS.flatMap(points => new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'catmullrom', .15).getPoints(180));
type Tree = {
    x: number;
    z: number;
    height: number;
    type: number;
    tone: number;
};
function seededRandom() { let state = ECOLOGY.seed; return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; }; }
export function createEcology(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'Scattered groves and open clearings';
    const random = seededRandom(), trees: Tree[] = [];
    const gaussian = () => Math.sqrt(-2 * Math.log(Math.max(.00001, random()))) * Math.cos(random() * Math.PI * 2);
    for (let attempt = 0; trees.length < ECOLOGY.count && attempt < ECOLOGY.maximumAttempts; attempt++) {
        const grove = GROVES[Math.floor(random() * GROVES.length)];
        const scattered = random() < .24;
        const x = scattered ? (random() - .5) * 116 : grove[0] + gaussian() * grove[2] * .62;
        const z = scattered ? (random() - .5) * 99 : grove[1] + gaussian() * grove[3] * .62;
        if (Math.hypot(x / 65, z / 60) > 1.12)
            continue;
        if (REMODELLED && Math.hypot(x, z) < 11)
            continue;
        if (SITES.some(([sx, sz, rx, rz]) => Math.hypot((x - sx) / rx, (z - sz) / rz) < 1))
            continue;
        if (ROUTES.some(p => Math.hypot(p.x - x, p.z - z) < ECOLOGY.roadClearance))
            continue;
        const height = 1.8 + random() ** .8 * 3.7;
        if (trees.some(tree => Math.hypot(tree.x - x, tree.z - z) < Math.max(ECOLOGY.minimumSpacing, (height + tree.height) * .24)))
            continue;
        trees.push({ x, z, height, type: Math.floor(random() * 3), tone: Math.floor(random() * 9) });
    }
    group.add(createBotanicalSprites(trees));
    group.userData.treeCount = trees.length;
    return group;
}
