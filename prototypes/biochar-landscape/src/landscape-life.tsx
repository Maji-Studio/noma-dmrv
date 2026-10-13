import { REMODELLED, ROUTE_POINTS, COMPOSITION, STATION_YAWS, SITE_SIZES } from './composition-state';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { elevation } from './terrain-height';
import { STEPS } from './process-data';
const FRAME_MS = 1000 / 24;
const FLOW_COUNT = 42;
const FLOW_SPEED = .045;
const FLOW_COLORS = [new THREE.Color('#FFB2D2'), new THREE.Color('#b18d9c'), new THREE.Color('#FFB2D2')];
const ATLAS_ROUTES = [
    new THREE.CatmullRomCurve3([[-36, .25, -3], [-23, .25, -3], [-13, .25, -3], [2, .25, -3]].map(p => new THREE.Vector3(...p))),
    new THREE.CatmullRomCurve3([[19, .25, 6], [27, .25, 7], [27, .25, 18], [12, .25, 18], [-15, .25, 18], [-15, .25, 22]].map(p => new THREE.Vector3(...p)), false, 'catmullrom', .15),
    new THREE.LineCurve3(new THREE.Vector3(4.7, STEPS[2].position[1] + 1, -8), new THREE.Vector3(13.7, STEPS[3].position[1] + 3.6, -3.15)),
];
const ROUTES = REMODELLED ? ROUTE_POINTS.map(points => new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'catmullrom', .15)) : ATLAS_ROUTES;
const CONTACT_VERTEX = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const SIZES = REMODELLED ? SITE_SIZES : [[16, 13], [12, 5], [15, 9], [13, 11], [12, 5], [22, 15]];
const FOCUS_FRAGMENT = `varying vec2 vUv;uniform vec2 size;uniform vec3 rose;
void main(){vec2 p=vUv*size;vec2 width=max(fwidth(p),vec2(.001));vec2 line=1.-smoothstep(width*.35,width*1.25,abs(fract(p)-.5));float grid=max(line.x,line.y);vec2 edge=min(vUv,1.-vUv)*size;float fade=smoothstep(0.,.6,min(edge.x,edge.y));gl_FragColor=vec4(rose,(.065+grid*.20)*fade);
#include <colorspace_fragment>
}`;
export function StageFocus({ index }: {
    index: number;
}) { if (index < 0)
    return null; const stage = STEPS[index]; return <group rotation={[0, STATION_YAWS[COMPOSITION][index], 0]} position={[stage.position[0], stage.position[1] + .33, stage.position[2]]}><mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}><planeGeometry args={SIZES[index] as [
    number,
    number
]}/><shaderMaterial vertexShader={CONTACT_VERTEX} fragmentShader={FOCUS_FRAGMENT} uniforms={{ size: { value: new THREE.Vector2(...SIZES[index] as [
            number,
            number
        ]) }, rose: { value: new THREE.Color('#FFB2D2') } }} transparent depthWrite={false} toneMapped={false}/></mesh>{[-1, 1].flatMap(x => [-1, 1].map(z => <group key={`${x}${z}`} position={[x * SIZES[index][0] / 2, 0, z * SIZES[index][1] / 2]}><mesh position={[-x * .65, 0, 0]} raycast={() => null}><boxGeometry args={[1.3, .025, .06]}/><meshBasicMaterial color="#FFB2D2" toneMapped={false}/></mesh><mesh position={[0, 0, -z * .65]} raycast={() => null}><boxGeometry args={[.06, .025, 1.3]}/><meshBasicMaterial color="#FFB2D2" toneMapped={false}/></mesh></group>))}</group>; }
/** A capped demand-render loop; inactive tabs and reduced-motion views stay still. */
export function MaterialFlow({ running, wind }: {
    running: boolean;
    wind: {
        value: number;
    };
}) {
    const { invalidate } = useThree();
    const particles = useRef<THREE.InstancedMesh>(null);
    const time = useRef(0), last = useRef(0), dummy = useRef(new THREE.Object3D());
    useEffect(() => { last.current = 0; if (!running)
        return; const tick = () => { if (!document.hidden)
        invalidate();
    else
        last.current = 0; }; const timer = window.setInterval(tick, FRAME_MS); return () => window.clearInterval(timer); }, [running, invalidate]);
    useFrame(() => {
        const now = performance.now();
        if (running && !document.hidden) {
            if (last.current)
                time.current += Math.min((now - last.current) / 1000, .1);
            last.current = now;
        }
        else
            last.current = 0;
        wind.value = time.current;
        if (!particles.current)
            return;
        for (let i = 0; i < FLOW_COUNT; i++) {
            const route = i % ROUTES.length;
            const progress = (Math.floor(i / ROUTES.length) / (FLOW_COUNT / ROUTES.length) + time.current * FLOW_SPEED * (route === 2 ? 2 : 1)) % 1;
            const p = ROUTES[route].getPointAt(progress);
            if (route !== 2)
                p.y = elevation(p.x, p.z) + .25;
            const d = dummy.current;
            d.position.copy(p);
            d.scale.set(route === 2 ? .16 : .12, route === 2 ? .12 : .045, route === 2 ? .16 : .12);
            d.updateMatrix();
            particles.current.setMatrixAt(i, d.matrix);
            particles.current.setColorAt(i, FLOW_COLORS[route]);
        }
        particles.current.instanceMatrix.needsUpdate = true;
        if (particles.current.instanceColor)
            particles.current.instanceColor.needsUpdate = true;
    });
    return <instancedMesh ref={particles} args={[undefined, undefined, FLOW_COUNT]} frustumCulled={false}><boxGeometry /><meshBasicMaterial /></instancedMesh>;
}
export function addWind(ecology: THREE.Group) {
    const time = { value: 0 };
    ecology.traverse(object => {
        if (!(object instanceof THREE.InstancedMesh) || !object.name.startsWith('Botanical'))
            return;
        const mat = object.material as THREE.MeshStandardMaterial;
        const pigment = mat.onBeforeCompile;
        mat.onBeforeCompile = (shader, renderer) => {
            pigment.call(mat, shader, renderer);
            shader.uniforms.uWindTime = time;
            shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
 float phase=instanceMatrix[3].x*.31+instanceMatrix[3].z*.23;
 // Sprite-local height is 0 at the roots and 1 at the crown.
 // The lower two thirds remain rigid, including the illustrated trunk.
 float canopyWeight=smoothstep(.70,1.,position.y);
 transformed.x+=sin(uWindTime*.85+phase)*.018*canopyWeight;`);
        };
        mat.customProgramCacheKey = () => 'maji-sketch-canopy-wind-v3';
    });
    return time;
}
