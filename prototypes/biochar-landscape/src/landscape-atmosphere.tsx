import { REMODELLED, STATION_LAYOUTS, COMPOSITION } from './composition-state';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { atlasRegion, atlasAspect } from './illustrated-atlas';
import { elevation } from './terrain';
const CLOUDS = [[-34, 16, -28, 15, 4.8], [24, 20, -34, 19, 5.7], [43, 12, 18, 11, 3.7], [-39, 10, 23, 10, 3.4]];
const CLOUD_TEXTURES = [8, 9, 10, 11].map(atlasRegion);
export function LandscapeClouds({ clock }: {
    clock: {
        value: number;
    };
}) { const group = useRef<THREE.Group>(null); useFrame(() => { group.current?.children.forEach((sprite, i) => { sprite.position.x = CLOUDS[i][0] + Math.sin(clock.value * .025 + i) * 1.6; sprite.position.y = CLOUDS[i][1] + Math.sin(clock.value * .045 + i) * .25; }); }); return <group ref={group}>{CLOUDS.map(([x, y, z, w, h], i) => <sprite key={i} position={[x, y, z]} scale={[w, w / atlasAspect(8 + i), 1]}><spriteMaterial map={CLOUD_TEXTURES[i]} transparent opacity={.72} depthWrite={false} toneMapped={false}/></sprite>)}</group>; }
function grassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const c = canvas.getContext('2d')!;
    let seed = 921;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 48; i++) {
        const x = 30 + rnd() * 132, y = 186, h = 28 + rnd() * 112, lean = (rnd() - .5) * 50;
        c.strokeStyle = ['#687d3f', '#8c9a50', '#b2aa62', '#7f8952'][i % 4];
        c.globalAlpha = .45 + rnd() * .45;
        c.lineWidth = .7 + rnd() * 1.4;
        c.beginPath();
        c.moveTo(x, y);
        c.quadraticCurveTo(x + lean * .2, y - h * .65, x + lean, y - h);
        c.stroke();
        if (i % 6 === 0) {
            c.fillStyle = i % 12 === 0 ? '#ffb77b' : '#f5e4bd';
            c.beginPath();
            c.ellipse(x + lean, y - h, 3, 2, 0, 0, Math.PI * 2);
            c.fill();
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
export function createFieldDetails() {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0, .5, 0);
    const material = new THREE.MeshBasicMaterial({ map: grassTexture(), transparent: true, alphaTest: .15, side: THREE.DoubleSide, depthWrite: true, toneMapped: false });
    const count = 96;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
        let x: number, z: number;
        if (i < 48) {
            x = -41 + (i % 24) * 3.4;
            z = -20 - Math.floor(i / 24) * 4 + Math.sin(i * 4.2) * 1.5;
        }
        else {
            x = i % 2 ? -35 : 35;
            z = -12 + (i - 48) * .8;
            x += Math.sin(i * 2) * 2;
        }
        if (REMODELLED) {
            const angle = i * 2.39996323;
            const radius = 45 + (i % 7) * 1.7;
            x = Math.cos(angle) * radius;
            z = Math.sin(angle) * radius;
            if (STATION_LAYOUTS[COMPOSITION].some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 13)) {
                x *= 1.22;
                z *= 1.22;
            }
        }
        dummy.position.set(x, elevation(x, z), z);
        dummy.rotation.y = Math.PI / 4 + Math.sin(i) * .3;
        dummy.scale.set(1.2 + Math.sin(i * 3) ** 2, .8 + Math.cos(i * 2) ** 2 * .7, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    }
    return mesh;
}
