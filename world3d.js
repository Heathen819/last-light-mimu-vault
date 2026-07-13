/* ============================================
   Last Light: Mimu Vault — 3D world renderer
   Maze from LEVEL_MAP + FPS camera + entities
   ============================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const NULL_GLB_VARIANTS = [
  "assets/enemies/null-black-gray-green-eyes3.glb?v=null1",
  "assets/enemies/null-black-purple.glb?v=null1",
];
const NULL_FLOAT_BASE_Y = 0.34;
const LANTERN_URL = "assets/objects/lanterns/rock-crystal-lantern.glb";
/** Sink lantern mesh so the rock base meets the floor (negative = lower). */
const LANTERN_Y_OFFSET = -0.12;
/** Lantern orientation — 180° on Y only (set 0 to restore default). */
const LANTERN_ROTATION_Y = Math.PI;
/** Raise lantern flame / glow bloom (+screen px, converted to world Y). */
const LANTERN_FLAME_Y_NUDGE_PX = 50;
const LANTERN_FLAME_DEPTH_REF = 2;
/** Additive bloom halos around lit lantern flame orbs. */
const LANTERN_BLOOM_LAYERS = [
  { scale: 0.1, opacity: 0.936 },
  { scale: 0.17, opacity: 0.442 },
  { scale: 0.26, opacity: 0.182 },
];
const LANTERN_FLAME_EMISSIVE = 2.6;
const LANTERN_GLOW_INTENSITY = 1.75;
const LANTERN_GLOW_DISTANCE = 5.5;
const EXIT_GLOW_INTENSITY = 2.1;
const EXIT_GLOW_DISTANCE = 8;
const EXIT_FLAME_EMISSIVE = 2.8;
const EXIT_LOCKED_EMISSIVE = 0.35;

// ── Environment lighting ──────────────────────────────────────────────
// Walls/floor/ceiling are LIT materials so the torch and lit lanterns create
// real pools of light. Keep ambient low so the dark actually reads as dark.
// Tune these to taste.
const ENV_AMBIENT_COLOR = 0x3a2c60;
const ENV_AMBIENT_INTENSITY = 0.16; // lifted a hair for visibility (was 0.10)
const ENV_HEMI_SKY = 0x6a5aa0;
const ENV_HEMI_GROUND = 0x140e24;
const ENV_HEMI_INTENSITY = 0.1; // lifted a hair (was 0.06)
const ENV_WALL_ROUGHNESS = 0.95;
const ENV_WALL_METALNESS = 0.0;
const ENV_FLOOR_ROUGHNESS = 0.98;
const ENV_CEIL_ROUGHNESS = 1.0;

// Player torch light — bright pool tight around the player, short reach so it
// doesn't spill far down corridors. High intensity + small distance = a strong
// but quickly-falling-off glow centered on the player.
const TORCH_BASE_INTENSITY = 3.6;
const TORCH_LIGHT_INTENSITY = 7.0;
const TORCH_BASE_DISTANCE = 3.4;
const TORCH_LIGHT_DISTANCE = 3.0;

function lanternFlameY(baseY) {
  const fov = Math.PI / 3;
  const viewH = 540;
  const nudge =
    (LANTERN_FLAME_Y_NUDGE_PX * LANTERN_FLAME_DEPTH_REF * Math.tan(fov / 2)) /
    (viewH / 2);
  return baseY + nudge;
}
const CAVE_ENV_URL = "assets/environment/crystal-cave-ref.jpg";
const CAVE_FLOOR_URL = "assets/environment/cave-floor.png";
const CAVE_WALL_URLS = [
  "assets/environment/cave-walls/cave-wall-01.png",
  "assets/environment/cave-walls/cave-wall-02.png",
  "assets/environment/cave-walls/cave-wall-03.png",
  "assets/environment/cave-walls/cave-wall-04.png",
  "assets/environment/cave-walls/cave-wall-05.png",
  "assets/environment/cave-walls/cave-wall-06.png",
  "assets/environment/cave-walls/cave-wall-07.png",
];

const EYE_HEIGHT = 0.52;
const WALL_HEIGHT = 2.45;
const CEILING_HEIGHT = 2.55;

/** Crop regions on crystal-cave-ref (UV: origin bottom-left). */
const CAVE_CROPS = {
  ceiling: { ox: 0, oy: 0.56, rx: 1, ry: 0.44 },
};

export function createWorld3D(canvas, options = {}) {
  const levelMap = options.levelMap;
  const mapRows = options.mapRows;
  const mapCols = options.mapCols;
  const fov = options.fov ?? Math.PI / 3;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x05030a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06040e);
  scene.fog = new THREE.Fog(0x12102a, 3.5, 12);

  const camera = new THREE.PerspectiveCamera(
    (fov * 180) / Math.PI,
    1,
    0.05,
    40
  );

  const torchLight = new THREE.PointLight(0xffa040, 2.4, 6.5, 1.7);
  camera.add(torchLight);
  scene.add(camera);

  const ambient = new THREE.AmbientLight(ENV_AMBIENT_COLOR, ENV_AMBIENT_INTENSITY);
  scene.add(ambient);

  const fillLight = new THREE.HemisphereLight(
    ENV_HEMI_SKY,
    ENV_HEMI_GROUND,
    ENV_HEMI_INTENSITY
  );
  scene.add(fillLight);

  const shell = buildShell(scene, levelMap, mapRows, mapCols);
  loadCaveEnvironment(scene, mapRows, mapCols, shell);
  loadCaveWallTextures(shell);

  const lanternMeshes = [];
  const nullMeshes = [];
  let exitMesh = null;
  const enemyTemplates = [];
  let lanternTemplate = null;

  const loader = new GLTFLoader();
  loader.load(
    LANTERN_URL,
    (gltf) => {
      lanternTemplate = normalizeLantern(gltf.scene);
      for (const g of lanternMeshes) ensureLanternBody(g);
      console.log("[world3d] crystal lantern template ready");
    },
    undefined,
    (err) => console.warn("[world3d] lantern GLB load failed", err)
  );
  NULL_GLB_VARIANTS.forEach((url, idx) => {
    loader.load(
      url,
      (gltf) => {
        enemyTemplates[idx] = normalizeNull(gltf.scene);
        console.log("[world3d] Null template ready", { variant: idx, url });
      },
      undefined,
      (err) =>
        console.warn("[world3d] Null GLB load failed — using placeholder until retry", {
          variant: idx,
          url,
          err,
        })
    );
  });

  function normalizeNull(root) {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.side = THREE.DoubleSide;
        m.transparent = true;
        m.opacity = m.opacity >= 1 ? 0.94 : (m.opacity ?? 0.94);
        if (!m.emissive) m.emissive = new THREE.Color(0x000000);
        m.emissiveIntensity = Math.max(m.emissiveIntensity ?? 0, 0.55);
        m.roughness = m.roughness ?? 0.55;
        m.metalness = m.metalness ?? 0.05;
        m.needsUpdate = true;
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    root.position.sub(center);
    const h = Math.max(size.y, 0.001);
    root.scale.setScalar(1.35 / h);
    return root;
  }

  function normalizeLantern(root) {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      obj.castShadow = false;
      obj.receiveShadow = false;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.side = THREE.DoubleSide;
        if (!m.emissive) m.emissive = new THREE.Color(0x000000);
        else m.emissive.multiplyScalar(0.35);
        m.emissiveIntensity = m.emissiveIntensity ?? 0.15;
        m.roughness = m.roughness ?? 0.82;
        m.metalness = m.metalness ?? 0.08;
        m.needsUpdate = true;
      }
    });

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    root.position.sub(center);
    root.position.y -= box.min.y;

    const targetH = 0.62;
    const h = Math.max(size.y, 0.001);
    root.scale.setScalar(targetH / h);

    if (LANTERN_ROTATION_Y) {
      root.rotation.x = 0;
      root.rotation.y = LANTERN_ROTATION_Y;
      root.rotation.z = 0;
      root.updateMatrixWorld(true);
      const turned = new THREE.Box3().setFromObject(root);
      root.position.y -= turned.min.y;
    }

    root.position.y += LANTERN_Y_OFFSET;

    root.updateMatrixWorld(true);
    const placed = new THREE.Box3().setFromObject(root);
    root.userData.flameY = placed.max.y * 0.88;
    return root;
  }

  function createLanternGroup() {
    const g = new THREE.Group();
    let flameY = 0.56;

    if (lanternTemplate) {
      const body = lanternTemplate.clone(true);
      body.name = "body";
      body.userData.isGlbLantern = true;
      flameY = lanternTemplate.userData.flameY ?? flameY;
      g.add(body);
    } else {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.05, 0.45, 6),
        new THREE.MeshStandardMaterial({ color: 0x1e1830, roughness: 0.9 })
      );
      post.position.y = 0.22;
      post.name = "body";
      const cage = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.22, 0.18),
        new THREE.MeshStandardMaterial({ color: 0x463828, roughness: 0.8 })
      );
      cage.position.y = 0.52;
      g.add(post, cage);
    }

    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0xffdd66,
        emissive: 0xffaa33,
        emissiveIntensity: LANTERN_FLAME_EMISSIVE,
        toneMapped: false,
      })
    );
    flame.position.y = lanternFlameY(flameY);
    flame.name = "flame";

    const bloomOrbs = new THREE.Group();
    bloomOrbs.name = "bloomOrbs";
    bloomOrbs.position.y = lanternFlameY(flameY);
    for (const layer of LANTERN_BLOOM_LAYERS) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(layer.scale, 10, 10),
        new THREE.MeshBasicMaterial({
          color: 0xffd060,
          transparent: true,
          opacity: layer.opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      );
      orb.renderOrder = 12;
      bloomOrbs.add(orb);
    }

    const glow = new THREE.PointLight(0xffc050, 0, LANTERN_GLOW_DISTANCE, 1.45);
    glow.position.y = lanternFlameY(flameY) + 0.02;
    glow.name = "glow";

    g.add(flame, bloomOrbs, glow);
    scene.add(g);
    return g;
  }

  function ensureLanternBody(g) {
    if (!lanternTemplate) return;
    const body = g.getObjectByName("body");
    if (body?.userData?.isGlbLantern) return;

    if (body) g.remove(body);

    const model = lanternTemplate.clone(true);
    model.name = "body";
    model.userData.isGlbLantern = true;
    g.add(model);

    const flameY = lanternFlameY(lanternTemplate.userData.flameY ?? 0.56);
    const flame = g.getObjectByName("flame");
    const bloomOrbs = g.getObjectByName("bloomOrbs");
    const glow = g.getObjectByName("glow");
    if (flame) flame.position.y = flameY;
    if (bloomOrbs) bloomOrbs.position.y = flameY;
    if (glow) glow.position.y = flameY + 0.02;
  }

  function variantForShadow(shadow, fallbackIndex = 0) {
    const base = shadow?.id ?? fallbackIndex;
    return Math.abs(base) % NULL_GLB_VARIANTS.length;
  }

  function spawnNullMesh(variant = 0) {
    const template = enemyTemplates[variant];
    if (!template) return null;
    const mesh = template.clone(true);
    mesh.userData.enemyVariant = variant;
    mesh.userData.isFallback = false;
    scene.add(mesh);
    return mesh;
  }

  function disposeNullMesh(mesh) {
    if (!mesh) return;
    scene.remove(mesh);
  }

  function ensureNullMesh(i, shadow) {
    const desiredVariant = variantForShadow(shadow, i);
    const hasTemplate = !!enemyTemplates[desiredVariant];
    let mesh = nullMeshes[i];

    // Swap placeholder capsules for real GLBs as soon as templates finish loading.
    if (mesh?.userData?.isFallback && hasTemplate) {
      disposeNullMesh(mesh);
      mesh = null;
    } else if (
      mesh &&
      hasTemplate &&
      !mesh.userData?.isFallback &&
      mesh.userData?.enemyVariant !== desiredVariant
    ) {
      disposeNullMesh(mesh);
      mesh = null;
    }

    if (!mesh && hasTemplate) {
      mesh = spawnNullMesh(desiredVariant);
    } else if (!mesh && !hasTemplate) {
      mesh = createFallbackNull();
    }

    nullMeshes[i] = mesh || null;
    return mesh;
  }

  function createExitGroup() {
    const g = new THREE.Group();

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 1.35, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x1a1430,
        emissive: 0x000000,
        emissiveIntensity: 0,
        roughness: 0.85,
      })
    );
    frame.position.y = 0.68;
    frame.name = "frame";

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 1.05, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x2a1848,
        emissive: 0x331808,
        emissiveIntensity: EXIT_LOCKED_EMISSIVE,
        roughness: 0.72,
      })
    );
    door.position.y = 0.62;
    door.name = "door";

    const doorFlame = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0xffdd66,
        emissive: 0xffaa33,
        emissiveIntensity: EXIT_LOCKED_EMISSIVE,
        toneMapped: false,
      })
    );
    doorFlame.position.set(0.2, 0.72, 0.06);
    doorFlame.name = "doorFlame";

    const doorBloom = new THREE.Group();
    doorBloom.name = "doorBloom";
    doorBloom.position.copy(doorFlame.position);
    for (const layer of LANTERN_BLOOM_LAYERS) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(layer.scale * 1.15, 10, 10),
        new THREE.MeshBasicMaterial({
          color: 0xffc040,
          transparent: true,
          opacity: layer.opacity * 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      );
      orb.renderOrder = 12;
      doorBloom.add(orb);
    }

    const doorGlow = new THREE.PointLight(0xffa040, 0.18, EXIT_GLOW_DISTANCE, 1.5);
    doorGlow.position.copy(doorFlame.position);
    doorGlow.name = "doorGlow";

    g.add(frame, door, doorFlame, doorBloom, doorGlow);
    scene.add(g);
    return g;
  }

  function syncEntities(data) {
    const { lanterns, shadows, exit } = data;

    while (lanternMeshes.length < lanterns.length) {
      lanternMeshes.push(createLanternGroup());
    }

    const lanternAnimTime = data.animTime || 0;

    lanterns.forEach((lantern, i) => {
      const g = lanternMeshes[i];
      ensureLanternBody(g);
      g.position.set(lantern.x, 0, lantern.y);
      const body = g.getObjectByName("body");
      const flame = g.getObjectByName("flame");
      const bloomOrbs = g.getObjectByName("bloomOrbs");
      const glow = g.getObjectByName("glow");
      const lit = !!lantern.lit;

      // Organic flame flicker: two out-of-phase sines per lantern (offset by i
      // so they never pulse in unison). Range ~0.7..1.0 — subtle enough that the
      // average brightness and light reach are unchanged (no balance impact).
      const flicker =
        0.85 +
        0.15 *
          (0.6 * Math.sin(lanternAnimTime * 9 + i * 1.7) +
            0.4 * Math.sin(lanternAnimTime * 15 + i * 3.1));

      if (body) body.visible = true;
      if (flame) {
        flame.visible = lit;
        if (lit && flame.material) {
          flame.material.emissiveIntensity = LANTERN_FLAME_EMISSIVE * flicker;
        }
      }
      if (bloomOrbs) {
        bloomOrbs.visible = lit;
        if (lit) bloomOrbs.scale.setScalar(0.9 + 0.14 * flicker);
      }
      if (glow) {
        glow.visible = lit;
        glow.intensity = lit ? LANTERN_GLOW_INTENSITY * flicker : 0;
      }
    });

    while (nullMeshes.length < shadows.length) {
      nullMeshes.push(null);
    }

    shadows.forEach((shadow, i) => {
      const mesh = ensureNullMesh(i, shadow);
      if (!mesh) return;
      const bob = shadow.bob || 0;
      mesh.position.set(shadow.x, bob + NULL_FLOAT_BASE_Y, shadow.y);
      mesh.rotation.y = shadow.faceAngle ?? 0;
      mesh.visible = true;
    });

    if (!exitMesh) {
      exitMesh = createExitGroup();
    }
    if (exit) {
      const animTime = data.animTime || 0;
      exitMesh.position.set(exit.x, 0, exit.y);
      const frame = exitMesh.getObjectByName("frame");
      const door = exitMesh.getObjectByName("door");
      const doorFlame = exitMesh.getObjectByName("doorFlame");
      const doorBloom = exitMesh.getObjectByName("doorBloom");
      const doorGlow = exitMesh.getObjectByName("doorGlow");
      const unlocked = !!exit.unlocked;
      const pulse = unlocked
        ? 0.72 + 0.28 * Math.sin(animTime * 2.5)
        : 0.55 + 0.15 * Math.sin(animTime * 1.6);

      if (frame?.material) {
        frame.material.color.setHex(unlocked ? 0x4a3018 : 0x1a1430);
        frame.material.emissive.setHex(unlocked ? 0x2a1408 : 0x000000);
        frame.material.emissiveIntensity = unlocked ? 0.22 * pulse : 0;
      }
      if (door?.material) {
        door.material.emissive.setHex(unlocked ? 0xffa030 : 0xff6018);
        door.material.emissiveIntensity = unlocked
          ? 0.95 * pulse
          : EXIT_LOCKED_EMISSIVE * pulse;
        door.material.color.setHex(unlocked ? 0x6a4820 : 0x321848);
      }
      if (doorFlame?.material) {
        doorFlame.visible = true;
        doorFlame.material.emissiveIntensity = unlocked
          ? EXIT_FLAME_EMISSIVE * pulse
          : EXIT_LOCKED_EMISSIVE * pulse;
      }
      if (doorBloom) {
        doorBloom.visible = true;
        doorBloom.children.forEach((orb, i) => {
          const layer = LANTERN_BLOOM_LAYERS[i];
          if (!layer || !orb.material) return;
          orb.material.opacity = layer.opacity * (unlocked ? 0.95 * pulse : 0.28 * pulse);
        });
      }
      if (doorGlow) {
        doorGlow.visible = true;
        doorGlow.intensity = unlocked
          ? EXIT_GLOW_INTENSITY * pulse
          : 0.28 * pulse;
        doorGlow.distance = unlocked ? EXIT_GLOW_DISTANCE : 4.5;
      }
    }
  }

  function createFallbackNull() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.22, 0.55, 4, 8),
      new THREE.MeshStandardMaterial({
        color: 0x4a3088,
        emissive: 0x2a1050,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.85,
      })
    );
    body.position.y = 0.55;
    g.add(body);
    g.userData.isFallback = true;
    scene.add(g);
    return g;
  }

  function update(data = {}) {
    const p = data.player;
    if (!p) return;

    const bob = data.bob || 0;
    const light = data.light == null ? 1 : data.light;

    camera.position.set(p.x, EYE_HEIGHT + bob * 0.02, p.y);

    const pitch = p.pitch ?? 0;
    const eyeY = EYE_HEIGHT + bob * 0.02;
    const lookDist = 1.2;
    const cosP = Math.cos(pitch);
    const lookX = p.x + Math.cos(p.angle) * cosP * lookDist;
    const lookY = eyeY + Math.sin(pitch) * lookDist;
    const lookZ = p.y + Math.sin(p.angle) * cosP * lookDist;
    camera.lookAt(lookX, lookY, lookZ);

    torchLight.intensity = TORCH_BASE_INTENSITY + light * TORCH_LIGHT_INTENSITY;
    torchLight.distance = TORCH_BASE_DISTANCE + light * TORCH_LIGHT_DISTANCE;
    torchLight.color.setRGB(1.0, 0.58 + light * 0.12, 0.22 + light * 0.08);

    const fogFar = 6.5 + light * 6;
    scene.fog.near = fogFar * 0.32;
    scene.fog.far = fogFar;

    syncEntities(data);
  }

  function render() {
    renderer.render(scene, camera);
  }

  function resize(cssWidth, cssHeight) {
    const w = Math.max(1, Math.floor(cssWidth));
    const h = Math.max(1, Math.floor(cssHeight));
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function dispose() {
    shell.dispose();
    renderer.dispose();
  }

  return {
    get ready() {
      return true;
    },
    update,
    render,
    resize,
    dispose,
    // Rebuild wall/floor-grid geometry after the shared levelMap array is
    // mutated in place (used to randomize the maze between runs).
    rebuildLevel() {
      shell.rebuildLevel();
    },
  };
}

function makeTiledTexture(image, tile = { x: 1, y: 1 }) {
  const tex = new THREE.Texture(image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(tile.x, tile.y);
  tex.needsUpdate = true;
  return tex;
}

function makeCroppedTexture(image, crop, tile = { x: 1, y: 1 }) {
  const tex = new THREE.Texture(image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.offset.set(crop.ox, crop.oy);
  tex.repeat.set(crop.rx * tile.x, crop.ry * tile.y);
  tex.needsUpdate = true;
  return tex;
}

function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function rockNoise(x, y, z, seed) {
  return (
    Math.sin((x + seed * 0.017) * 2.1) * 0.42 +
    Math.sin((y + seed * 0.031) * 3.4) * 0.28 +
    Math.sin((z + seed * 0.023) * 2.7) * 0.42 +
    Math.sin((x + z + seed) * 4.8) * 0.18
  );
}

function displaceRockVertices(geo, amp, seed, outward = null, halfExtents = null, air = null) {
  const pos = geo.attributes.position;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i);
    const n = rockNoise(tmp.x * 2.4, tmp.y * 1.8, tmp.z * 2.4, seed + i);
    if (outward) {
      tmp.addScaledVector(outward, n * amp);
    } else if (halfExtents) {
      const [hx, hy, hz] = halfExtents;
      const shellX = Math.abs(tmp.x) >= hx * 0.82;
      const shellY = Math.abs(tmp.y) >= hy * 0.82;
      const shellZ = Math.abs(tmp.z) >= hz * 0.82;

      if (shellX && tmp.x < 0) {
        if (air?.nx) tmp.x += Math.max(0, n) * amp * 0.12;
        else tmp.x += Math.sign(tmp.x || -1) * n * amp * 0.55;
      } else if (shellX && tmp.x > 0) {
        if (air?.px) tmp.x -= Math.max(0, n) * amp * 0.12;
        else tmp.x += Math.sign(tmp.x || 1) * n * amp * 0.55;
      }

      if (shellZ && tmp.z < 0) {
        if (air?.nz) tmp.z += Math.max(0, n) * amp * 0.12;
        else tmp.z += Math.sign(tmp.z || -1) * n * amp * 0.55;
      } else if (shellZ && tmp.z > 0) {
        if (air?.pz) tmp.z -= Math.max(0, n) * amp * 0.12;
        else tmp.z += Math.sign(tmp.z || 1) * n * amp * 0.55;
      }

      if (shellY) tmp.y += Math.sign(tmp.y || 1) * n * amp * 0.35;
    } else {
      const len = tmp.length();
      if (len > 1e-5) tmp.addScaledVector(tmp.multiplyScalar(1 / len), n * amp * 0.35);
    }
    pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  pos.needsUpdate = true;
}

function buildRockWallGroup(col, row, levelMap, mapRows, mapCols, material) {
  const group = new THREE.Group();
  const seed = col * 1319 + row * 6271;

  const air = {
    nx: col <= 0 || levelMap[row][col - 1] === 0,
    px: col >= mapCols - 1 || levelMap[row][col + 1] === 0,
    nz: row <= 0 || levelMap[row - 1][col] === 0,
    pz: row >= mapRows - 1 || levelMap[row + 1][col] === 0,
  };

  const coreHalf = [0.5, WALL_HEIGHT * 0.5, 0.5];
  const core = new THREE.BoxGeometry(1, WALL_HEIGHT, 1, 5, 10, 5);
  displaceRockVertices(core, 0.07, seed, null, coreHalf, air);
  const coreMesh = new THREE.Mesh(core, material);
  coreMesh.position.y = WALL_HEIGHT * 0.5;
  group.add(coreMesh);

  return group;
}

function loadCaveWallTextures(shell) {
  const loader = new THREE.TextureLoader();
  const pending = CAVE_WALL_URLS.length;
  const loaded = new Array(pending);

  CAVE_WALL_URLS.forEach((url, i) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        loaded[i] = tex;
        if (loaded.filter(Boolean).length === pending) {
          shell.setWallTextures(loaded);
          console.log("[world3d] cave wall textures applied");
        }
      },
      undefined,
      (err) => console.warn("[world3d] cave wall texture failed", url, err)
    );
  });
}

function loadCaveEnvironment(scene, mapRows, mapCols, shell) {
  const loader = new THREE.TextureLoader();

  loader.load(
    CAVE_FLOOR_URL,
    (image) => {
      const floorTex = makeTiledTexture(image, {
        x: Math.max(2.2, mapCols / 3.2),
        y: Math.max(1.6, mapRows / 2),
      });
      shell.setFloorTexture(floorTex);
      shell.textures.push(floorTex);
      console.log("[world3d] cave floor texture loaded");
    },
    undefined,
    (err) => console.warn("[world3d] cave floor load failed", err)
  );

  loader.load(
    CAVE_ENV_URL,
    (image) => {
      const ceilingTex = makeCroppedTexture(image, CAVE_CROPS.ceiling, {
        x: Math.max(2.2, mapCols / 4.5),
        y: Math.max(1.6, mapRows / 3.2),
      });

      shell.setCeilingTexture(ceilingTex);
      shell.textures.push(ceilingTex);

      scene.fog.color.setHex(0x18142e);
      scene.fog.far = 11.5;
      console.log("[world3d] crystal cave ceiling loaded");
    },
    undefined,
    (err) => console.warn("[world3d] cave ceiling load failed", err)
  );
}

function wallHasFloorNeighbor(levelMap, row, col, mapRows, mapCols) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= mapRows || c >= mapCols) continue;
      if (levelMap[r][c] === 0) return true;
    }
  }
  return false;
}

function buildShell(scene, levelMap, mapRows, mapCols) {
  const textures = [];
  let ceilingMesh = null;
  let floorMesh = null;
  const wallMeshes = [];
  const wallFallbackMat = new THREE.MeshStandardMaterial({
    color: 0x5a5078,
    roughness: ENV_WALL_ROUGHNESS,
    metalness: ENV_WALL_METALNESS,
    side: THREE.DoubleSide,
  });

  const floorGeo = new THREE.PlaneGeometry(mapCols, mapRows);
  floorGeo.rotateX(-Math.PI / 2);
  floorMesh = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({
      color: 0x9088a8,
      roughness: ENV_FLOOR_ROUGHNESS,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  );
  floorMesh.position.set(mapCols * 0.5, 0.02, mapRows * 0.5);
  scene.add(floorMesh);

  const ceilGeo = new THREE.PlaneGeometry(mapCols, mapRows);
  ceilGeo.rotateX(Math.PI / 2);
  ceilingMesh = new THREE.Mesh(
    ceilGeo,
    new THREE.MeshStandardMaterial({
      color: 0xc8c0d8,
      roughness: ENV_CEIL_ROUGHNESS,
      metalness: 0,
      side: THREE.DoubleSide,
    })
  );
  ceilingMesh.position.set(mapCols * 0.5, CEILING_HEIGHT, mapRows * 0.5);
  scene.add(ceilingMesh);

  const wallGroup = new THREE.Group();
  wallGroup.name = "walls";
  scene.add(wallGroup);

  const gridMat = new THREE.LineBasicMaterial({
    color: 0x3a2868,
    transparent: true,
    opacity: 0.18,
  });
  let gridLines = null;
  let wallBaseTextures = null;

  function buildWalls() {
    // Clear any existing wall meshes (used for maze regeneration).
    for (const group of wallMeshes) {
      group.traverse((obj) => {
        if (!obj.isMesh) return;
        if (obj.material && obj.material !== wallFallbackMat) obj.material.dispose?.();
        obj.geometry?.dispose?.();
      });
      wallGroup.remove(group);
    }
    wallMeshes.length = 0;

    for (let row = 0; row < mapRows; row++) {
      for (let col = 0; col < mapCols; col++) {
        if (levelMap[row][col] !== 1) continue;
        // Skip fully enclosed exterior walls that no open tile can ever see.
        if (!wallHasFloorNeighbor(levelMap, row, col, mapRows, mapCols)) continue;
        const rock = buildRockWallGroup(col, row, levelMap, mapRows, mapCols, wallFallbackMat);
        rock.position.set(col + 0.5, 0, row + 0.5);
        rock.userData.wallCol = col;
        rock.userData.wallRow = row;
        wallGroup.add(rock);
        wallMeshes.push(rock);
      }
    }
  }

  function buildGrid() {
    if (gridLines) {
      scene.remove(gridLines);
      gridLines.geometry?.dispose?.();
      gridLines = null;
    }
    const gridPts = [];
    for (let row = 0; row < mapRows; row++) {
      for (let col = 0; col < mapCols; col++) {
        if (levelMap[row][col] === 1) continue;
        const x0 = col;
        const z0 = row;
        const x1 = col + 1;
        const z1 = row + 1;
        gridPts.push(
          x0, 0.01, z0, x1, 0.01, z0,
          x1, 0.01, z0, x1, 0.01, z1,
          x1, 0.01, z1, x0, 0.01, z1,
          x0, 0.01, z1, x0, 0.01, z0
        );
      }
    }
    if (gridPts.length) {
      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(gridPts, 3)
      );
      gridLines = new THREE.LineSegments(gridGeo, gridMat);
      scene.add(gridLines);
    }
  }

  function applyWallTextures(baseTextures) {
    wallBaseTextures = baseTextures;
    for (const group of wallMeshes) {
      const col = group.userData.wallCol;
      const row = group.userData.wallRow;
      const idx = (col * 13 + row * 7) % baseTextures.length;
      const tex = baseTextures[idx].clone();
      tex.offset.set((col % 5) * 0.19, (row % 4) * 0.21);
      tex.needsUpdate = true;

      const mat = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xffffff,
        roughness: ENV_WALL_ROUGHNESS,
        metalness: ENV_WALL_METALNESS,
        side: THREE.DoubleSide,
      });
      textures.push(tex);

      group.traverse((obj) => {
        if (!obj.isMesh) return;
        const prev = obj.material;
        obj.material = mat;
        if (prev && prev !== wallFallbackMat && prev !== mat) prev.dispose?.();
      });
    }
  }

  buildWalls();
  buildGrid();

  return {
    textures,
    vistaMaterial: null,
    setWallTextures: applyWallTextures,
    rebuildLevel() {
      buildWalls();
      buildGrid();
      if (wallBaseTextures) applyWallTextures(wallBaseTextures);
    },
    setCeilingTexture(tex) {
      if (!ceilingMesh) return;
      const prev = ceilingMesh.material;
      ceilingMesh.material = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xe0d8f0,
        roughness: ENV_CEIL_ROUGHNESS,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      prev?.dispose?.();
    },
    setFloorTexture(tex) {
      if (!floorMesh) return;
      const prev = floorMesh.material;
      floorMesh.material = new THREE.MeshStandardMaterial({
        map: tex,
        color: 0xffffff,
        roughness: ENV_FLOOR_ROUGHNESS,
        metalness: 0,
        side: THREE.DoubleSide,
      });
      prev?.dispose?.();
    },
    dispose() {
      for (const t of textures) t.dispose();
      for (const group of wallMeshes) {
        group.traverse((obj) => {
          if (!obj.isMesh) return;
          if (obj.material && obj.material !== wallFallbackMat) {
            obj.material.dispose?.();
          }
          obj.geometry?.dispose?.();
        });
      }
      wallFallbackMat.dispose();
      ceilingMesh?.material?.dispose?.();
      floorMesh?.material?.dispose?.();
      this.vistaMaterial?.dispose?.();
      floorMesh?.geometry?.dispose?.();
      floorGeo.dispose();
      ceilGeo.dispose();
      if (gridLines) {
        scene.remove(gridLines);
        gridLines.geometry?.dispose?.();
      }
    },
  };
}
