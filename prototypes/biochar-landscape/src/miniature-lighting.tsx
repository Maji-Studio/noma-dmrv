// Environment reused from the user's Zürich miniature export. GI maps are geometry-specific.
import { useEffect } from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import * as THREE from 'three';
import sunset from './sunset.hdr';
const LIGHTING = { environment: .8, rotation: -96, exposure: 1.2 };
export function MiniatureLighting() {
    const texture = useLoader(HDRLoader, sunset);
    const { scene, gl, invalidate } = useThree();
    useEffect(() => { texture.mapping = THREE.EquirectangularReflectionMapping; scene.environment = texture; scene.environmentIntensity = LIGHTING.environment; scene.environmentRotation.set(0, THREE.MathUtils.degToRad(LIGHTING.rotation), 0); gl.toneMapping = THREE.AgXToneMapping; gl.toneMappingExposure = LIGHTING.exposure; invalidate(); return () => { scene.environment = null; }; }, [texture, scene, gl, invalidate]);
    return <><hemisphereLight intensity={1.1} color="#ffffff" groundColor="#cec7cb"/><directionalLight position={[-85, 44.5, -52]} intensity={2.5} color="#fff9f6"/></>;
}
