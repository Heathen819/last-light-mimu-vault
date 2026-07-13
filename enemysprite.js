/* ============================================
   Null — pre-render GLB to 2D sprite
   Model: assets/enemies/null-black-purple.glb
   ============================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const NULL_GLB = "assets/enemies/null-black-purple.glb";
const ENEMY_URL = NULL_GLB;
const SPRITE_SIZE = 384;

function ghostMaterialFrom(source) {
  const ghost = new THREE.Color(0.78, 0.62, 1.0);
  if (source?.color?.isColor) ghost.copy(source.color).lerp(new THREE.Color(0.9, 0.75, 1.0), 0.55);
  return new THREE.MeshBasicMaterial({
    map: source?.map || null,
    color: ghost,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    depthWrite: true,
    toneMapped: false,
  });
}

function maxAlpha(canvas) {
  const c = document.createElement("canvas");
  c.width = canvas.width;
  c.height = canvas.height;
  const cx = c.getContext("2d");
  cx.drawImage(canvas, 0, 0);
  const data = cx.getImageData(0, 0, c.width, c.height).data;
  let max = 0;
  for (let i = 3; i < data.length; i += 4) max = Math.max(max, data[i]);
  return max;
}

export function createEnemySprite() {
  let ready = false;
  let loadError = null;
  let spriteCanvas = null;

  function bakeModel(model) {
    model.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      obj.material = mats.map((m) => {
        const basic = ghostMaterialFrom(m);
        if (basic.map) basic.map.colorSpace = THREE.SRGBColorSpace;
        return basic;
      });
    });

    const scene = new THREE.Scene();
    scene.add(model);

    const hemi = new THREE.AmbientLight(0xd8c8ff, 1.35);
    scene.add(hemi);
    const rim = new THREE.DirectionalLight(0xffffff, 1.1);
    rim.position.set(1.5, 2.5, 2.8);
    scene.add(rim);

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    model.position.sub(center);

    const maxDim = Math.max(size.x, size.y, size.z, 0.001);
    model.scale.setScalar(1.65 / maxDim);

    box.setFromObject(model);
    box.getSize(size);
    const fitHeight = Math.max(size.y, 0.001);

    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
    const dist = fitHeight * 2.1;
    camera.position.set(0, size.y * 0.18, dist);
    camera.lookAt(0, size.y * 0.1, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(SPRITE_SIZE, SPRITE_SIZE);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.render(scene, camera);

    const out = document.createElement("canvas");
    out.width = SPRITE_SIZE;
    out.height = SPRITE_SIZE;
    out.getContext("2d").drawImage(renderer.domElement, 0, 0);
    renderer.dispose();
    return out;
  }

  const loader = new GLTFLoader();
  loader.load(
    ENEMY_URL,
    (gltf) => {
      const baked = bakeModel(gltf.scene.clone(true));
      let peak = maxAlpha(baked);

      if (peak < 12) {
        console.warn("[enemySprite] bake was empty — retrying with flat ghost material");
        const fallback = gltf.scene.clone(true);
        fallback.traverse((obj) => {
          if (!obj.isMesh) return;
          obj.material = new THREE.MeshBasicMaterial({
            color: new THREE.Color(0.72, 0.55, 0.98),
            transparent: true,
            opacity: 0.92,
            side: THREE.DoubleSide,
            toneMapped: false,
          });
        });
        spriteCanvas = bakeModel(fallback);
        peak = maxAlpha(spriteCanvas);
      } else {
        spriteCanvas = baked;
      }

      ready = true;
      console.log("[enemySprite] Null ready", { maxAlpha: peak });
    },
    undefined,
    (err) => {
      loadError = err;
      console.error("Failed to load enemy sprite GLB:", err);
    }
  );

  return {
    get ready() {
      return ready;
    },
    get canvas() {
      return spriteCanvas;
    },
    get error() {
      return loadError;
    },
  };
}
