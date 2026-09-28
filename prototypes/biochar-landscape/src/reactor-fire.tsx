import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE } from './model-kit';
const FIRE = { position: [1.8, .28, 3.2] as THREE.Vector3Tuple, intensity: 18, distance: 7 };
const vertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const fragment = `varying vec2 vUv;uniform float uTime;
void main(){
 float y=vUv.y;float sway=sin(y*9.-uTime*4.8)*.035*y+sin(y*15.-uTime*3.1)*.025*y;
 float x=vUv.x-.5+sway;
 float height=.83+.06*sin(uTime*5.3)+.035*sin(uTime*9.7);
 float width=.28*pow(max(0.,1.-y/height),.7);
 float edge=abs(x)-width;
 float flame=(1.-smoothstep(-.025,.045,edge))*(1.-smoothstep(height-.12,height,y))*smoothstep(0.,.08,y);
 float core=(1.-smoothstep(.01,.14,abs(x)))*(1.-smoothstep(.22,.65,y));
 vec3 color=mix(vec3(1.,.24,.045),vec3(1.,.66,.15),1.-y);
 color=mix(color,vec3(1.,.94,.65),core);
 gl_FragColor=vec4(color,flame*.95);
}`;
/** External burner flame; the retort stays enclosed. Uses the shared pausable ambient clock. */
export function ReactorFire({ clock }: {
    clock: {
        value: number;
    };
}) {
    const light = useRef<THREE.PointLight>(null);
    const uniforms = useRef({ uTime: { value: 0 } });
    useFrame(() => { const t = clock.value; uniforms.current.uTime.value = t; if (light.current)
        light.current.intensity = FIRE.intensity * (.92 + .12 * Math.sin(t * 5.3) + .06 * Math.sin(t * 9.7)); });
    return <group position={FIRE.position}>
  <mesh position={[0, .45, -1.2]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[.13, .13, 2.4, 10]}/><meshStandardMaterial color={PALETTE.compost} roughness={1}/></mesh>
  <mesh position={[0, 1.05, -2.3]}><cylinderGeometry args={[.13, .13, 1.35, 10]}/><meshStandardMaterial color={PALETTE.compost} roughness={1}/></mesh>
  <mesh position={[0, .1, 0]}><boxGeometry args={[1.35, .2, 1.1]}/><meshStandardMaterial color={PALETTE.compost} roughness={1}/></mesh>
  <mesh position={[0, .52, -.35]}><boxGeometry args={[1.15, .85, .15]}/><meshStandardMaterial color={PALETTE.ink} roughness={1}/></mesh>
  {[-1, 1].map(side => <mesh key={side} position={[side * .55, .5, 0]}><boxGeometry args={[.14, .8, .8]}/><meshStandardMaterial color={PALETTE.red} roughness={1}/></mesh>)}
  <mesh position={[0, .21, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[.42, 16]}/><meshBasicMaterial color="#ff9344" transparent opacity={.65} toneMapped={false}/></mesh>
  <mesh position={[0, .88, .2]}><planeGeometry args={[1.2, 1.6]}/><shaderMaterial uniforms={uniforms.current} vertexShader={vertex} fragmentShader={fragment} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false}/></mesh>
  <pointLight ref={light} position={[0, .9, .5]} color="#ff9d43" intensity={FIRE.intensity} distance={FIRE.distance} decay={2} castShadow={false}/>
 </group>;
}
