import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

interface Props {
  // An equirectangular-projection canvas (2:1). The component wraps it onto a sphere.
  equirectangular: HTMLCanvasElement | null;
}

const MIN_DISTANCE = 1.6;
const MAX_DISTANCE = 6;
const INITIAL_DISTANCE = 3;

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
    // Prevent iOS Safari from intercepting two-finger gestures for page pinch-zoom — without this
    // the OS swallows the pinch before OrbitControls sees it.
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, INITIAL_DISTANCE);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = MIN_DISTANCE;
    controls.maxDistance = MAX_DISTANCE;
    // One finger rotates, two fingers pinch-zoom (dolly). Pan is disabled above.
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    const geometry = new THREE.SphereGeometry(1, 64, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const sphere = new THREE.Mesh(geometry, material);
    // Three.js wraps equirectangular textures starting at +X; rotate so the texture's centre (lon=0) faces the camera.
    sphere.rotation.y = Math.PI / 2;
    scene.add(sphere);

    const applySize = () => {
      const w = Math.max(64, container.clientWidth);
      const h = Math.max(64, container.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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

  const zoomBy = useCallback((factor: number) => {
    const state = stateRef.current;
    if (!state) return;
    const { camera, controls } = state;
    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const dist = offset.length();
    const next = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, dist * factor));
    if (next === dist) return;
    offset.setLength(next);
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }, []);

  const resetZoom = useCallback(() => {
    const state = stateRef.current;
    if (!state) return;
    const { camera, controls } = state;
    controls.target.set(0, 0, 0);
    camera.position.set(0, 0, INITIAL_DISTANCE);
    controls.update();
  }, []);

  return (
    <div ref={containerRef} className="globe-view">
      <div className="zoom-controls" aria-label="Globe zoom controls">
        <button
          type="button"
          className="zoom-btn"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => zoomBy(1 / 1.25)}
        >
          +
        </button>
        <button
          type="button"
          className="zoom-btn"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => zoomBy(1.25)}
        >
          −
        </button>
        <button
          type="button"
          className="zoom-btn"
          aria-label="Reset view"
          title="Reset view"
          onClick={resetZoom}
        >
          ⤾
        </button>
      </div>
    </div>
  );
}
