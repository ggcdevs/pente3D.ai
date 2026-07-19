import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createLogger } from '../debug/log.ts';

const log = createLogger('render:scene');

/** A plain-number camera readout, safe to serialize and assert on from Playwright. */
export interface CameraReadout {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/** The live scene handle exposed to the app and (via window.__pente) to tests. */
export interface SceneHandle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Camera position + orbit target as plain numbers. */
  getCamera(): CameraReadout;
  dispose(): void;
}

/**
 * Build a minimal orbitable placeholder scene: a 3x3x3 lattice of spheres (a stand-in
 * for the eventual board) plus orbit/pan/zoom controls. This is the walking skeleton
 * that de-risks agent-driven 3D testing — it renders something a drag visibly moves.
 */
export function createScene(container: HTMLElement): SceneHandle {
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101014);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(6, 5, 8);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.target.set(0, 0, 0);

  // Lights.
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 7);
  scene.add(dir);

  // Placeholder lattice: a small grid of spheres centered on the origin.
  const N = 3;
  const spacing = 2;
  const offset = ((N - 1) * spacing) / 2;
  const geometry = new THREE.SphereGeometry(0.35, 24, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0x4a90d9, roughness: 0.4 });
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      for (let z = 0; z < N; z++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x * spacing - offset, y * spacing - offset, z * spacing - offset);
        scene.add(mesh);
      }
    }
  }

  function getCamera(): CameraReadout {
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
    };
  }

  let running = true;
  function renderLoop(): void {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  }
  renderLoop();

  function onResize(): void {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  function dispose(): void {
    running = false;
    window.removeEventListener('resize', onResize);
    controls.dispose();
    renderer.dispose();
    geometry.dispose();
    material.dispose();
    renderer.domElement.remove();
  }

  log.info('scene initialized', {
    spheres: N * N * N,
    camera: getCamera(),
    size: { width, height },
  });

  return { scene, camera, renderer, controls, getCamera, dispose };
}
