import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

interface Props {
  // An equirectangular-projection canvas (2:1). The component wraps it onto a sphere.
  equirectangular: HTMLCanvasElement | null;
}

export function GlobeView({ equirectangular }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    sphere: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    texture: THREE.CanvasTexture | null;
    raf: number;
  } | null>(null);

  // One-time scene setup. Container size is read from the actual DOM element so the globe fills
  // whatever its parent layout gives it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 1.6;
    controls.maxDistance = 6;

    const geometry = new THREE.SphereGeometry(1, 64, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const sphere = new THREE.Mesh(geometry, material);
    // Three.js wraps equirectangular textures starting at +X; rotate so the texture's centre (lon=0) faces the camera.
    sphere.rotation.y = Math.PI / 2;
    scene.add(sphere);

    const applySize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const size = Math.max(64, Math.min(w, h));
      renderer.setSize(size, size, false);
      // The renderer's canvas is square — center it inside the container via CSS in the parent.
    };
    applySize();

    const ro = new ResizeObserver(applySize);
    ro.observe(container);

    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    stateRef.current = { renderer, scene, camera, controls, sphere, material, texture: null, raf };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      geometry.dispose();
      material.dispose();
      stateRef.current?.texture?.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      stateRef.current = null;
    };
  }, []);

  // Update texture when the input canvas changes. Reuse the CanvasTexture instead of recreating it
  // every change — only the underlying canvas image and `needsUpdate = true` are swapped, so the GPU
  // sees an in-place upload rather than a full texture lifecycle each tick of the slider.
  useEffect(() => {
    const state = stateRef.current;
    if (!state) return;

    if (!equirectangular) {
      state.texture?.dispose();
      state.texture = null;
      state.material.map = null;
      state.material.color.set(0x222222);
      state.material.needsUpdate = true;
      return;
    }

    if (!state.texture) {
      const tex = new THREE.CanvasTexture(equirectangular);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = state.renderer.capabilities.getMaxAnisotropy();
      state.texture = tex;
      state.material.map = tex;
      state.material.color.set(0xffffff);
      state.material.needsUpdate = true;
    } else {
      state.texture.image = equirectangular;
      state.texture.needsUpdate = true;
    }
  }, [equirectangular]);

  return <div ref={containerRef} className="globe-view" />;
}
