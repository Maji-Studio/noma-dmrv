// Hidden-line SVG contours of the biochar-landscape station models, one per trace step (TraceStage).
// The models live in prototypes/biochar-landscape on feat/biochar-landscape-studies; this script only
// reads them, renders feature edges (creases, boundaries, view silhouettes) from a fixed 3/4 camera and
// keeps the parts no surface hides (BVH ray toward the camera). Output is one contour path per file plus
// a few small motion overlays (see MODELS) that TraceStage loops in CSS.
// Usage, from site/: node scripts/export-contours.mjs <prototypes/biochar-landscape dir> src/components/site/contours [id ...]
// Trailing ids render only those models (e.g. `source`); without them every model is rendered.
// The prototype dir needs its own `pnpm install` (three, three-mesh-bvh via drei, esbuild).
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const [PROTO, OUT, ...ONLY] = process.argv.slice(2);
const req = createRequire(path.join(PROTO, 'package.json'));
const { build } = req('esbuild');
const bvhPath = createRequire(req.resolve('@react-three/drei')).resolve('three-mesh-bvh');
globalThis.__landscapeComposition = 'atlas';

const entry = `
import * as THREE from 'three';
import { MeshBVH } from ${JSON.stringify(bvhPath)};
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createTipper, createFlatbed, createFeedstock } from './src/model-logistics';
import { createReactor, createMixer } from './src/model-production';
import { createFarmSurface } from './src/model-farm';
import { bulkBag } from './src/model-kit';
export { THREE, MeshBVH, mergeGeometries, mergeVertices, createTipper, createFlatbed, createFeedstock, createReactor, createMixer, createFarmSurface, bulkBag };`;
const bundled = await build({ stdin: { contents: entry, resolveDir: PROTO, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const { THREE, MeshBVH, mergeGeometries, mergeVertices } = M;

const VIEW_W = 480;          // viewBox width; height follows the model
const PAD = 8;
const SAMPLE = 0.7;          // visibility sample spacing in viewBox units
const CREASE_DEG = 28;       // same threshold the prototype's pencil edges use
const MIN_SEG = 1.2;         // drop visible runs shorter than this

function bags() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7], [2.1, -0.7]]) M.bulkBag(g, [x, 0, z]);
  return g;
}

// Loop motion (TraceStage animates these classes in CSS; the contour itself never moves):
//   truck: a street (two edges and a lane line whose dashes scroll past) and spinning spokes on the
//          wheels that face the camera; the model's own wheel bolts are left out so only spokes turn
//   streams: grains falling onto world points    smoke: puffs rising from the model's highest part
//   spray: the model's granule dots drift and fade
// Trucks face +x, so street lines run from the back (-x) to the front and scroll toward the back.
const STREET_X = [-7.6, 6.4];
const STREET_Z = { far: 2.1, lane: 2.2, near: 4.4 }; // metres from the truck's centre line
const WHEELS = { x: [-3.75, -2.15, 3.65], y: 0.73, face: 1.575 }; // truckBase axles, hub face offset
const BOLT_RADIUS = 0.033; // truckBase wheel bolts: static circles that would fight the spokes
const STREAM_H = 2.2; // metres of falling grains above each stream point
// Three spokes and six bolt dots around the hub, in metres on the wheel plane.
const polar = (r, deg) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)].map((v) => Math.round(v * 1000) / 1000).join(' ');
const SPOKES = [0, 120, 240].map((a) => `M${polar(0.12, a)}L${polar(0.42, a)}`).join('') + [30, 90, 150, 210, 270, 330].map((a) => `M${polar(0.29, a)}h0`).join('');

// az: camera azimuth (deg, around Y), el: elevation (deg). clip: world-space box to keep.
const MODELS = [
  { id: 'source', make: M.createFeedstock, az: 35, el: 28 }, // the supplier's residue yard: timber stack and chip piles
  { id: 'feedstock-delivery', make: M.createTipper, az: 35, el: 24, fx: { truck: true } },
  { id: 'production-run', make: M.createReactor, az: 40, el: 26, fx: { smoke: true } },
  { id: 'mix-bin', make: M.createMixer, az: 40, el: 28, fx: { streams: [[-3.3, 3.25, -3.15], [0, 3.25, -3.15]] } }, // the two feed hoppers
  { id: 'biochar-product', make: bags, az: 35, el: 26, fx: { streams: [[0.7, 1.51, 0.7]] } }, // the front bag's spout
  { id: 'delivery', make: M.createFlatbed, az: 215, el: 24, fx: { truck: true } },
  { id: 'application', make: M.createFarmSurface, az: 30, el: 30, clip: { min: [-8.2, -1, -2.6], max: [4.6, 8, 3.2] }, fx: { spray: true } },
];

function inClip(box, clip) {
  return !clip || box.intersectsBox(new THREE.Box3(new THREE.Vector3(...clip.min), new THREE.Vector3(...clip.max)));
}

// Liang-Barsky: clip a world segment to the clip box, or null when it lies outside.
function clipSegment(a, b, clip) {
  if (!clip) return [a, b];
  let t0 = 0, t1 = 1;
  const d = b.clone().sub(a);
  for (const axis of ['x', 'y', 'z']) {
    const i = { x: 0, y: 1, z: 2 }[axis];
    for (const [p, q] of [[-d[axis], a[axis] - clip.min[i]], [d[axis], clip.max[i] - a[axis]]]) {
      if (p === 0) { if (q < 0) return null; continue; }
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
      if (t0 > t1) return null;
    }
  }
  return [a.clone().addScaledVector(d, t0), a.clone().addScaledVector(d, t1)];
}

function render(spec) {
  const group = spec.make();
  group.updateMatrixWorld(true);
  const meshes = [];
  const dots = []; // tiny instances (granules) become single round-capped dots
  const add = (geometry, matrix) => {
    const g = geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g.applyMatrix4(matrix);
    g.computeBoundingBox();
    if (inClip(g.boundingBox, spec.clip)) meshes.push(g);
  };
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (spec.fx?.truck && o.geometry.parameters?.radiusTop === BOLT_RADIUS) return;
    if (!o.isInstancedMesh) return add(o.geometry, o.matrixWorld);
    if (o.geometry.type === 'ShapeGeometry') return; // crop leaves: noise at icon size
    const m = new THREE.Matrix4();
    o.geometry.computeBoundingSphere();
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      m.premultiply(o.matrixWorld);
      if (o.geometry.boundingSphere.radius * m.getMaxScaleOnAxis() < 0.1) {
        const c = new THREE.Vector3().setFromMatrixPosition(m);
        if (inClip(new THREE.Box3(c, c), spec.clip)) dots.push(c);
      } else add(o.geometry, m);
    }
  });

  const az = (spec.az * Math.PI) / 180, el = (spec.el * Math.PI) / 180;
  const toCam = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toCam).normalize();
  const up = new THREE.Vector3().crossVectors(toCam, right).normalize();
  const proj = (p) => [p.dot(right), -p.dot(up)];

  const bvh = new MeshBVH(mergeGeometries(meshes.map((g) => (g.index ? g.toNonIndexed() : g))), { maxLeafTris: 8 });
  const cosCrease = Math.cos((CREASE_DEG * Math.PI) / 180);

  // World-space feature edges: creases, boundaries, and silhouettes for this view.
  const edges = [];
  for (const src of meshes) {
    const g = mergeVertices(src.index ? src.toNonIndexed() : src, 1e-4);
    const pos = g.attributes.position, idx = g.index.array;
    const P = (i) => new THREE.Vector3().fromBufferAttribute(pos, i);
    const faces = [];
    const map = new Map();
    for (let f = 0; f < idx.length; f += 3) {
      const a = idx[f], b = idx[f + 1], c = idx[f + 2];
      const n = new THREE.Vector3().crossVectors(P(b).sub(P(a)), P(c).sub(P(a)));
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      const fi = faces.push(n) - 1;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u}_${v}` : `${v}_${u}`;
        (map.get(key) || map.set(key, { u, v, f: [] }).get(key)).f.push(fi);
      }
    }
    for (const { u, v, f } of map.values()) {
      let keep = f.length !== 2;
      let normal = faces[f[0]].clone();
      if (!keep) {
        const n1 = faces[f[0]], n2 = faces[f[1]];
        keep = n1.dot(n2) < cosCrease || Math.sign(n1.dot(toCam)) !== Math.sign(n2.dot(toCam));
        normal.add(n2).normalize();
      }
      const seg = keep && clipSegment(P(u), P(v), spec.clip);
      if (seg) edges.push([...seg, normal]);
    }
  }

  // Motion overlays in world space; their extents count toward the fit so nothing leaves the frame.
  const fx = spec.fx || {};
  const V = (p) => new THREE.Vector3(...p);
  // The street sits on the camera's side of the truck (near = +z when the camera looks from +z).
  const side = Math.sign(toCam.z) || 1;
  const line = (z) => [V([STREET_X[0], 0, z]), V([STREET_X[1], 0, z])];
  const kerbs = fx.truck ? [line(-side * STREET_Z.far), line(side * STREET_Z.near)] : [];
  const lane = fx.truck ? [line(side * STREET_Z.lane)] : [];
  const wheels = fx.truck ? WHEELS.x.map((x) => V([x, WHEELS.y, side * WHEELS.face])) : [];
  const streams = (fx.streams || []).map((p) => [V(p).add(new THREE.Vector3(0, STREAM_H, 0)), V(p)]);
  let smoke = null;
  if (fx.smoke) {
    const top = meshes.map((g) => g.boundingBox).reduce((best, b) => (b.max.y > best.max.y ? b : best));
    smoke = new THREE.Vector3((top.min.x + top.max.x) / 2, top.max.y, (top.min.z + top.max.z) / 2);
  }
  const extents = [...kerbs.flat(), ...streams.flat(), ...(smoke ? [smoke.clone().add(new THREE.Vector3(0, 3, 0))] : [])];

  // Fit to viewBox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of [...edges.flatMap(([a, b]) => [a, b]), ...extents]) {
    const [x, y] = proj(p);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const scale = (VIEW_W - PAD * 2) / (maxX - minX);
  const H = Math.ceil((maxY - minY) * scale + PAD * 2);
  const screen = (p) => { const [x, y] = proj(p); return [(x - minX) * scale + PAD, (y - minY) * scale + PAD]; };

  const ray = new THREE.Ray();
  const probe = new THREE.Vector3();
  const visible = (p, n) => {
    probe.copy(p).addScaledVector(toCam, 0.012).addScaledVector(n, 0.004);
    ray.set(probe, toCam);
    return !bvh.raycastFirst(ray, THREE.DoubleSide);
  };

  // Visible screen runs of a world segment.
  function visibleRuns(a, b, n, out) {
    const [ax, ay] = screen(a), [bx, by] = screen(b);
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.3) return out;
    const steps = Math.max(2, Math.ceil(len / SAMPLE));
    let start = null;
    const p = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      p.lerpVectors(a, b, t);
      const vis = visible(p, n);
      if (vis && start === null) start = t;
      if ((!vis || i === steps) && start !== null) {
        const end = vis ? t : (i - 1) / steps;
        if ((end - start) * len >= MIN_SEG) out.push([ax + (bx - ax) * start, ay + (by - ay) * start, ax + (bx - ax) * end, ay + (by - ay) * end]);
        start = null;
      }
    }
    return out;
  }
  const segs = [];
  for (const [a, b, n] of edges) visibleRuns(a, b, n, segs);

  // Chain segments that share endpoints into polylines to keep the file small.
  const r = (v) => Math.round(v * 10) / 10;
  const k = (x, y) => `${r(x)},${r(y)}`;
  const byEnd = new Map();
  segs.forEach((s, i) => { for (const key of [k(s[0], s[1]), k(s[2], s[3])]) (byEnd.get(key) || byEnd.set(key, []).get(key)).push(i); });
  const used = new Uint8Array(segs.length);
  let d = '';
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const pts = [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]];
    for (;;) {
      const [lx, ly] = pts[pts.length - 1];
      const next = (byEnd.get(k(lx, ly)) || []).find((j) => !used[j]);
      if (next === undefined) break;
      used[next] = 1;
      const s = segs[next];
      pts.push(k(s[0], s[1]) === k(lx, ly) ? [s[2], s[3]] : [s[0], s[1]]);
    }
    d += 'M' + pts.map(([x, y]) => `${r(x)} ${r(y)}`).join('L');
  }
  let spray = '';
  for (const c of dots) {
    probe.copy(c).addScaledVector(toCam, 0.1);
    ray.set(probe, toCam);
    if (bvh.raycastFirst(ray, THREE.DoubleSide)) continue;
    const [x, y] = screen(c);
    if (fx.spray) spray += `M${r(x)} ${r(y)}h0`;
    else d += `M${r(x)} ${r(y)}h0`;
  }
  const tidy = (path) => path.replace(/ -/g, '-');
  const runsD = (lines) => tidy(lines.flatMap(([a, b]) => visibleRuns(a, b, toCam, [])).map((q) => `M${q.map(r).join(' ')}`).join('').replace(/(M[^ ]+ [^ ]+) /g, '$1L'));

  // pathLength="1" lets CSS plot the whole contour in with one dash offset.
  let body = `<g class="fx-body"><path class="contour" pathLength="1" d="${tidy(d)}"/></g>`;
  if (kerbs.length) body += `<path class="fx-kerb" d="${runsD(kerbs)}"/><path class="fx-lane" d="${runsD(lane)}"/>`;
  // Spokes live in the wheel's own plane (world x/y, metres); the matrix projects that plane onto the
  // screen, so a CSS rotate on .fx-spin turns them on the true wheel ellipse.
  for (const c of wheels) {
    const ax = (v) => [scale * v.dot(right), -scale * v.dot(up)];
    const [a, b] = ax(V([1, 0, 0])), [cc, dd] = ax(V([0, 1, 0]));
    const [e, f] = screen(c);
    const m = [a, b, cc, dd, e, f].map((v) => Math.round(v * 100) / 100).join(' ');
    body += `<g transform="matrix(${m})"><path class="fx-spin" d="${SPOKES}"/></g>`;
  }
  if (streams.length) body += `<path class="fx-stream" d="${runsD(streams)}"/>`;
  if (smoke) {
    const [x, y] = screen(smoke).map(r);
    body += `<g class="fx-smoke">${'<circle cx="X" cy="Y" r="9"/>'.repeat(3).replaceAll('X', x).replaceAll('Y', y)}</g>`;
  }
  if (spray) body += `<g class="fx-spray"><path id="ts-spray-${spec.id}" d="${tidy(spray)}"/><use href="#ts-spray-${spec.id}"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${H}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  return { id: spec.id, svg, segs: segs.length, h: H };
}

await mkdir(OUT, { recursive: true });
for (const spec of MODELS.filter((m) => !ONLY.length || ONLY.includes(m.id))) {
  const out = render(spec);
  await writeFile(path.join(OUT, `${out.id}.svg`), out.svg);
  console.log(out.id, `${VIEW_W}x${out.h}`, out.segs, 'segs', (out.svg.length / 1024).toFixed(1), 'KB');
}
