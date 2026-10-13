import { REMODELLED } from './composition-state';
import { STEPS } from './process-data';
// Throwaway procedural terrain with derivative-antialiased contour and survey-grid shader.
import * as THREE from 'three';
import { PALETTE, box, beam, material } from './model-kit';
import { LAND, elevation, siteElevation } from './terrain-height';
import lightBake from './bakes/terrain-light-bake.json';
import { SHADING_UNIFORMS } from './shading-state';
export { LAND, elevation } from './terrain-height';
const vertexShader = `attribute vec3 bakedLighting;varying vec3 vBake;varying vec3 vWorld;varying vec3 vNormal;void main(){vWorld=position;vNormal=normal;vBake=bakedLighting;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragmentShader = `
precision highp float;
varying vec3 vWorld;varying vec3 vNormal;varying vec3 vBake;
uniform vec3 uPaper;uniform vec3 uOrange;uniform vec3 uRose;uniform vec3 uInk;uniform float uStudy;uniform float uIllustrated;uniform float uShadingMode;
float rule(float p,float thickness){float edge=abs(fract(p+.5)-.5);return 1.-smoothstep(thickness*fwidth(p), (thickness+1.)*fwidth(p),edge);}
float studyRule(float p,float thickness){float footprint=max(fwidth(p),.00001);float edge=abs(fract(p+.5)-.5);float line=1.-smoothstep(thickness*footprint,(thickness+1.)*footprint,edge);return mix(line,0.,smoothstep(.18,.65,footprint));}
void main(){
 float relief=smoothstep(.15,10.,vWorld.y);
 float diffuse=clamp(dot(normalize(vNormal),normalize(vec3(-.85,.445,-.52))),0.,1.);
 float meander=sin(vWorld.x*.105+sin(vWorld.z*.13)*1.8)+cos(vWorld.z*.095-vWorld.x*.04);
 float meadow=smoothstep(-.55,.85,meander);
 float outside=smoothstep(13.,39.,length(vWorld.xz*vec2(.9,1.)));
 float slope=1.-normalize(vNormal).y;
 float wash=(.06+outside*.20+relief*.28)*(1.-slope*.5);
 vec3 soil=mix(uPaper,uOrange,.045+outside*.12);
 vec3 base=mix(soil,uRose,meadow*wash);
 base=mix(base,uOrange,(1.-meadow)*relief*.19);
 // Broad, offset field parcels read as quiet colour shapes rather than foliage noise.
 vec2 fieldCell=floor((vWorld.xz+vec2(floor(vWorld.z/13.)*3.7,0.))/vec2(16.,13.));
 float fieldTone=fract(sin(dot(fieldCell,vec2(12.9898,78.233)))*43758.5453);
 vec3 fieldGreen=mix(uRose,vec3(.42,.51,.29),fieldTone*.17);
 vec3 fieldColour=mix(fieldGreen,mix(uPaper,uOrange,.35),smoothstep(.72,.82,fieldTone));
 float fieldMask=1.-smoothstep(42.,73.,length(vWorld.xz*vec2(.85,1.)));
 base=mix(base,fieldColour,uIllustrated*fieldMask*.68);
 // These visibility values were baked offline against the actual modified terrain.
 float terrainMask=smoothstep(.05,1.2,vWorld.y);
 float sky=vBake.x;
 float sunshine=diffuse*vBake.y;
 vec3 shadowTint=mix(vec3(1.),uInk,.5);
 vec3 lit=base*(.57+sky*.18+sunshine*.48);
 lit=mix(lit,lit*shadowTint,(1.-sky)*.6);
 lit+=uOrange*(sunshine*.055+vBake.z*.24);
 base=mix(base,lit,terrainMask);
 float minor=rule(vWorld.y*1.35,.24)*smoothstep(.15,.7,vWorld.y);
 float major=rule(vWorld.y*.27,.6)*smoothstep(.4,1.5,vWorld.y);
 float grid=max(rule(vWorld.x/3.,.1),rule(vWorld.z/3.,.1));
 float grain=fract(sin(dot(vWorld.xz,vec2(12.9898,78.233)))*43758.5453);
 base=mix(base,uInk,grain*.003);
 base=mix(base,uInk,grid*uStudy*.024);
 base=mix(base,uInk,minor*(.02+uStudy*.13));
 base=mix(base,uInk,major*(.04+uStudy*.12));
 // All studies reuse the same baked visibility and unchanged terrain geometry.
 if(uShadingMode>.5&&uShadingMode<1.5){
  vec3 simpleFields=mix(uPaper,mix(uRose,vec3(.57,.64,.40),.25),fieldMask*(.30+step(.45,fieldTone)*.19));
  base=simpleFields*(.88+.12*step(.40,sunshine));
 }else if(uShadingMode>1.5&&uShadingMode<2.5){
  base=mix(uPaper,vec3(.91,.92,.88),terrainMask*(1.-sky)*.24);
  float surveyGrid=max(studyRule(vWorld.x/6.,.30),studyRule(vWorld.z/6.,.30));
  float contourFine=studyRule(vWorld.y*1.35,.24)*smoothstep(.15,.7,vWorld.y);
  float contourBold=studyRule(vWorld.y*.27,.6)*smoothstep(.4,1.5,vWorld.y);
  base=mix(base,uInk,contourFine*.12+contourBold*.27+surveyGrid*.07);
 }else if(uShadingMode>2.5&&uShadingMode<3.5){
  vec3 hybridFields=mix(uPaper,fieldColour,fieldMask*.49);
  base=hybridFields*(.75+sky*.13+sunshine*.18);
  base=mix(base,uInk,minor*.04+major*.14+grid*.024);
 }else if(uShadingMode>3.5&&uShadingMode<4.5){
  vec3 porcelain=mix(uPaper,vec3(.91,.90,.87),.36);
  base=porcelain*(.58+sky*.25+sunshine*.25);
  base=mix(base,base*vec3(.77,.79,.80),(1.-sky)*.52);
 }else if(uShadingMode>4.5){
  vec3 printPaper=mix(uPaper,vec3(.92,.89,.76),.35);
  vec3 printGreen=mix(uRose,vec3(.48,.56,.35),.46);
  base=mix(printPaper,printGreen,fieldMask*(.24+step(.50,fieldTone)*.24));
  float shadowDensity=clamp((1.-sky)*1.7+(1.-sunshine)*.14,0.,.8);
  vec2 dotGrid=mat2(.965926,-.258819,.258819,.965926)*gl_FragCoord.xy/3.;
  float radius=.055+shadowDensity*.34;
  float dots=1.-smoothstep(radius-.045,radius+.045,length(fract(dotGrid)-.5));
  base=mix(base,uInk,dots*.35);
 }
 float edgeFade=smoothstep(.62,.97,max(abs(vWorld.x)/90.,abs(vWorld.z)/80.));
 base=mix(base,uPaper,edgeFade);
 gl_FragColor=vec4(base,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
export function createTerrain(study = false) {
    const group = new THREE.Group();
    group.name = 'Contour terrain';
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [], indices: number[] = [];
    for (let zi = 0; zi <= LAND.segmentsZ; zi++)
        for (let xi = 0; xi <= LAND.segmentsX; xi++) {
            const x = xi / LAND.segmentsX * LAND.width - LAND.width / 2, z = zi / LAND.segmentsZ * LAND.depth - LAND.depth / 2;
            vertices.push(x, elevation(x, z), z);
        }
    for (let zi = 0; zi < LAND.segmentsZ; zi++)
        for (let xi = 0; xi < LAND.segmentsX; xi++) {
            const x = (xi + .5) / LAND.segmentsX * LAND.width - LAND.width / 2, z = (zi + .5) / LAND.segmentsZ * LAND.depth - LAND.depth / 2;
            // Root-zone opening at the front edge lets the farm cutaway remain genuinely visible.
            if (!REMODELLED && x > -26.3 && x < -3.7 && z > 33.4 && z < (study ? 48 : 38))
                continue;
            const a = zi * (LAND.segmentsX + 1) + xi, b = a + 1, c = a + LAND.segmentsX + 1, d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.setAttribute('bakedLighting', new THREE.Float32BufferAttribute(lightBake.values, 3));
    const shader = new THREE.ShaderMaterial({ toneMapped: false, vertexShader, fragmentShader, uniforms: { ...SHADING_UNIFORMS, uPaper: { value: new THREE.Color(PALETTE.ground) }, uOrange: { value: new THREE.Color(PALETTE.orange) }, uRose: { value: new THREE.Color('#72954f') }, uInk: { value: new THREE.Color(PALETTE.ink) }, uStudy: { value: study ? 1 : 0 }, uIllustrated: { value: 0 } } });
    group.add(new THREE.Mesh(geometry, shader));
    // Plantation parcels are fine linework, deliberately subordinate to the six process models.
    for (const [x, z, w, d] of [[-32, 10, 18, 10], [30, -13, 17, 9], [28, 28, 14, 9], [-49, 29, 28, 18], [-53, -17, 25, 16], [46, 43, 32, 18], [61, -15, 28, 24], [0, -52, 30, 20], [-31, 53, 32, 18], [18, 54, 20, 18]] as number[][]) {
        const parcel = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: x < 0 ? PALETTE.paleOrange : PALETTE.pale, transparent: true, opacity: .12, depthWrite: false }));
        parcel.rotation.x = -Math.PI / 2;
        parcel.position.set(x, .025, z);
        group.add(parcel);
        const points = [new THREE.Vector3(x - w / 2, .05, z - d / 2), new THREE.Vector3(x + w / 2, .05, z - d / 2), new THREE.Vector3(x + w / 2, .05, z + d / 2), new THREE.Vector3(x - w / 2, .05, z + d / 2), new THREE.Vector3(x - w / 2, .05, z - d / 2)];
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: PALETTE.pink, transparent: true, opacity: .10 })));
        for (let dz = -d / 2 + 1; dz < d / 2; dz += .75) {
            group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x - w / 2 + .5, .06, z + dz), new THREE.Vector3(x + w / 2 - .5, .06, z + dz)]), new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: .035 })));
        }
    }
    // A large low-complexity paper plane extends beyond the detailed DEM mesh.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshBasicMaterial({ color: PALETTE.ground, toneMapped: false }));
    floor.material.userData.paperSurface = true;
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -8;
    group.add(floor);
    return group;
}
export function road(points: THREE.Vector3Tuple[], color: string) {
    const group = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'catmullrom', .15);
    const samples = curve.getPoints(160);
    const positions: number[] = [], indices: number[] = [];
    const halfWidth = 1.9, crossSegments = 10;
    samples.forEach((p, i) => {
        const tangent = curve.getTangent(i / (samples.length - 1));
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        // Subdivide across the lane as well as along it, so rolling terrain cannot poke through.
        for (let lane = 0; lane <= crossSegments; lane++) {
            const offset = (lane / crossSegments * 2 - 1) * halfWidth;
            const x = p.x + normal.x * offset, z = p.z + normal.z * offset;
            positions.push(x, elevation(x, z) + .18, z);
            if (i < samples.length - 1 && lane < crossSegments) {
                const a = i * (crossSegments + 1) + lane, b = a + crossSegments + 1;
                indices.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const roadMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.paper).lerp(new THREE.Color(color), .14), roughness: 1, side: THREE.DoubleSide });
    roadMaterial.userData.paletteRole = 'road';
    group.add(new THREE.Mesh(geo, roadMaterial));
    for (const side of [-1, 1]) {
        const pts = samples.map((p, i) => { const t = curve.getTangent(i / (samples.length - 1)); return new THREE.Vector3(p.x - t.z * halfWidth * side, elevation(p.x - t.z * halfWidth * side, p.z + t.x * halfWidth * side) + .20, p.z + t.x * halfWidth * side); });
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: .16 })));
    }
    const center = new THREE.Line(new THREE.BufferGeometry().setFromPoints(samples.map(p => new THREE.Vector3(p.x, elevation(p.x, p.z) + .21, p.z))), new THREE.LineDashedMaterial({ color, dashSize: .8, gapSize: 1, transparent: true, opacity: .3 }));
    center.computeLineDistances();
    group.add(center);
    for (let i = 15; i < 150; i += 27) {
        const p = samples[i], t = curve.getTangent(i / 160), n = new THREE.Vector3(-t.z, 0, t.x);
        const arrow = [p.clone().addScaledVector(t, -.6).addScaledVector(n, .35), p.clone().addScaledVector(t, .2), p.clone().addScaledVector(t, -.6).addScaledVector(n, -.35)].map(v => new THREE.Vector3(v.x, elevation(v.x, v.z) + .23, v.z));
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arrow), new THREE.LineBasicMaterial({ color })));
    }
    return group;
}
export function createConveyor() { const g = new THREE.Group(); const a: THREE.Vector3Tuple = [STEPS[2].position[0] + 5.7, STEPS[2].position[1] + .75, STEPS[2].position[2]], b: THREE.Vector3Tuple = [STEPS[3].position[0] - 3.3, STEPS[3].position[1] + 3.35, STEPS[3].position[2] - 3.15]; for (const dz of [-.5, .5])
    beam(g, [a[0], a[1], a[2] + dz], [b[0], b[1], b[2] + dz], .07, PALETTE.ink); for (let i = 0; i <= 15; i++) {
    const t = i / 15;
    const p = new THREE.Vector3(...a).lerp(new THREE.Vector3(...b), t);
    beam(g, [p.x, p.y, p.z - .5], [p.x, p.y, p.z + .5], .065, PALETTE.pale);
} for (const p of [a, b])
    for (const dz of [-.5, .5])
        beam(g, [p[0], elevation(p[0], p[2] + dz) + .21, p[2] + dz], [p[0], p[1], p[2] + dz], .07); return g; }
