/* ============================================
   Last Light: Mimu Vault — 3D world renderer
   Maze from LEVEL_MAP + FPS camera + entities
   ============================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { applyPlacementFor } from "./placement-offsets.js?v=2";
import { createStonePathCanvas } from "./stone-path-texture.js?v=2";

const NULL_GLB_VARIANTS = [
  "assets/enemies/green_Null_decimated_small.glb?v=null4",
  "assets/enemies/purple_Null_decimated_small.glb?v=null4",
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
/** Additive bloom halos around lit lantern flames (vertical ellipsoids). */
const LANTERN_BLOOM_LAYERS = [
  { scaleX: 0.07, scaleY: 0.13, opacity: 0.9 },
  { scaleX: 0.12, scaleY: 0.22, opacity: 0.42 },
  { scaleX: 0.18, scaleY: 0.32, opacity: 0.16 },
];
const LANTERN_FLAME_EMISSIVE = 2.6;
const LANTERN_GLOW_INTENSITY = 1.75;
const LANTERN_GLOW_DISTANCE = 5.5;
const _lanternGlowColor = new THREE.Color();
const _lanternGlowWarm = new THREE.Color(0xff9020);
const _lanternGlowHot = new THREE.Color(0xffe080);
const EXIT_GLOW_INTENSITY = 2.1;
const EXIT_GLOW_DISTANCE = 8;
const EXIT_FLAME_EMISSIVE = 2.8;
const EXIT_LOCKED_EMISSIVE = 0.35;
const EXIT_VAULT_RADIUS = 0.62;
const EXIT_VAULT_Y = 0.72;
const EXIT_METAL_LOCKED = 0x8a6a42;
const EXIT_METAL_UNLOCKED = 0xc49a55;
const EXIT_RIM_LOCKED = 0x6a5234;
const EXIT_RIM_UNLOCKED = 0xa88448;

let vaultMetalMap = null;

/** One-shot brushed bronze canvas map for the vault door. */
function getVaultMetalTexture() {
  if (vaultMetalMap) return vaultMetalMap;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8a7048";
  ctx.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    const a = 0.03 + Math.random() * 0.09;
    ctx.fillStyle =
      Math.random() > 0.5
        ? `rgba(255, 230, 180, ${a})`
        : `rgba(35, 26, 16, ${a})`;
    ctx.fillRect(0, y, size, 1);
  }
  for (let i = 0; i < 5000; i++) {
    const x = (Math.random() * size) | 0;
    const y = (Math.random() * size) | 0;
    ctx.fillStyle = `rgba(255, 240, 200, ${Math.random() * 0.07})`;
    ctx.fillRect(x, y, 1, 1);
  }
  vaultMetalMap = new THREE.CanvasTexture(canvas);
  vaultMetalMap.colorSpace = THREE.SRGBColorSpace;
  vaultMetalMap.wrapS = THREE.RepeatWrapping;
  vaultMetalMap.wrapT = THREE.RepeatWrapping;
  vaultMetalMap.repeat.set(2.2, 2.2);
  vaultMetalMap.needsUpdate = true;
  return vaultMetalMap;
}

function makeVaultMetalMaterial(colorHex, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: colorHex,
    map: getVaultMetalTexture(),
    metalness: opts.metalness ?? 0.92,
    roughness: opts.roughness ?? 0.32,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
    side: THREE.DoubleSide,
  });
}

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
// Fraction of the source image shown per wall tile. Lower = larger-looking texture.
const WALL_TEX_REPEAT_U = 0.36; // ~2.8× wider
const WALL_TEX_REPEAT_V = 0.42; // ~2.4× taller
const ENV_FLOOR_ROUGHNESS = 0.98;
/** Tint multiplied over the stone path texture. Lower/darker = darker floor. */
const ENV_FLOOR_TINT = 0x807a96;
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
/** World units covered by one floor texture tile. Lower = smaller slabs. */
const FLOOR_TILE_WORLD_UNITS = 1.6;

/** Original crystal-wall set (kept for revert via ?walls=v1). */
const WALL_SET_V1 = [
  "assets/environment/cave-walls/v1/cave-wall-01.png",
  "assets/environment/cave-walls/v1/cave-wall-02.png",
  "assets/environment/cave-walls/v1/cave-wall-03.png",
  "assets/environment/cave-walls/v1/cave-wall-04.png",
  "assets/environment/cave-walls/v1/cave-wall-05.png",
  "assets/environment/cave-walls/v1/cave-wall-06.png",
  "assets/environment/cave-walls/v1/cave-wall-07.png",
];
/** New cave-wall plates (default). */
const WALL_SET_V2 = [
  "assets/environment/cave-walls/v2/wall-01.png",
  "assets/environment/cave-walls/v2/wall-02.png",
  "assets/environment/cave-walls/v2/wall-03.png",
  "assets/environment/cave-walls/v2/wall-04.png",
];

function resolveWallSetUrls() {
  let set = "v2";
  try {
    const q = new URLSearchParams(window.location.search).get("walls");
    if (q === "v1" || q === "v2") set = q;
  } catch {
    /* ignore */
  }
  return set === "v1" ? WALL_SET_V1 : WALL_SET_V2;
}

const CAVE_WALL_URLS = resolveWallSetUrls();

/**
 * Assign a texture index to each wall cell so orthogonal neighbors prefer
 * different plates. Falls back to any index if every neighbor bans a choice.
 */
function assignWallTextureIndices(wallMeshes, texCount, seed) {
  const rng = seededRand(seed >>> 0);
  const assigned = new Map();
  const key = (c, r) => `${c},${r}`;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  const cells = wallMeshes
    .map((g) => ({
      g,
      c: g.userData.wallCol,
      r: g.userData.wallRow,
    }))
    .sort((a, b) => a.r - b.r || a.c - b.c);

  for (const cell of cells) {
    const banned = new Set();
    for (const [dc, dr] of dirs) {
      const n = assigned.get(key(cell.c + dc, cell.r + dr));
      if (n != null) banned.add(n);
    }
    const choices = [];
    for (let i = 0; i < texCount; i++) {
      if (!banned.has(i)) choices.push(i);
    }
    const pool = choices.length ? choices : [...Array(texCount).keys()];
    const idx = pool[Math.floor(rng() * pool.length)];
    assigned.set(key(cell.c, cell.r), idx);
    cell.g.userData.wallTexIdx = idx;
  }
}

const EYE_HEIGHT = 0.52;
const WALL_HEIGHT = 2.45;
const CEILING_HEIGHT = 2.55;

/** Crop regions on crystal-cave-ref (UV: origin bottom-left). */
const CAVE_CROPS = {
  ceiling: { ox: 0, oy: 0.56, rx: 1, ry: 0.44 },
};

export function createWorld3D(canvas, options = {}) {
  let levelMap = options.levelMap;
  let mapRows = options.mapRows;
  let mapCols = options.mapCols;
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

    const flame = createLanternFlameGroup();
    flame.position.y = lanternFlameY(flameY);

    const bloomOrbs = new THREE.Group();
    bloomOrbs.name = "bloomOrbs";
    bloomOrbs.position.y = lanternFlameY(flameY);
    for (const layer of LANTERN_BLOOM_LAYERS) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 10),
        new THREE.MeshBasicMaterial({
          color: 0xffb040,
          transparent: true,
          opacity: layer.opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      );
      orb.scale.set(layer.scaleX, layer.scaleY, layer.scaleX);
      orb.position.y = layer.scaleY * 0.15;
      orb.renderOrder = 12;
      bloomOrbs.add(orb);
    }

    const glow = new THREE.PointLight(0xffc050, 0, LANTERN_GLOW_DISTANCE, 1.45);
    glow.position.y = lanternFlameY(flameY) + 0.06;
    glow.name = "glow";

    g.add(flame, bloomOrbs, glow);
    scene.add(g);
    return g;
  }

  /** Layered teardrop flame — hot core, orange body, additive tip. */
  function createLanternFlameGroup() {
    const flame = new THREE.Group();
    flame.name = "flame";

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0xfff2c0,
        emissive: 0xffeeaa,
        emissiveIntensity: LANTERN_FLAME_EMISSIVE * 1.15,
        toneMapped: false,
        transparent: true,
        depthWrite: false,
      })
    );
    core.name = "flameCore";
    core.position.y = 0.02;
    core.renderOrder = 13;

    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.052, 0.155, 10, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xffa028,
        emissive: 0xff7a18,
        emissiveIntensity: LANTERN_FLAME_EMISSIVE,
        toneMapped: false,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    body.name = "flameBody";
    body.position.y = 0.08;
    body.renderOrder = 12;

    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(0.028, 0.1, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff6020,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    tip.name = "flameTip";
    tip.position.y = 0.16;
    tip.renderOrder = 14;

    flame.add(core, body, tip);
    flame.visible = false;
    return flame;
  }

  function ensureLanternBody(g) {
    if (!lanternTemplate) return;
    const body = g.getObjectByName("body");
    if (body?.userData?.isGlbLantern) return;

    // Drop placeholder meshes (post/cage) before attaching the GLB body.
    for (const child of [...g.children]) {
      if (
        child.name === "flame" ||
        child.name === "bloomOrbs" ||
        child.name === "glow"
      ) {
        continue;
      }
      g.remove(child);
    }

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
    const r = EXIT_VAULT_RADIUS;

    // Face group: local Y = door thickness (world ±Z after rotateX).
    const face = new THREE.Group();
    face.name = "vaultFace";
    face.position.y = EXIT_VAULT_Y;
    face.rotation.x = Math.PI / 2;

    const doorMat = makeVaultMetalMaterial(EXIT_METAL_LOCKED, {
      emissive: 0x3a2010,
      emissiveIntensity: EXIT_LOCKED_EMISSIVE,
      roughness: 0.34,
    });
    const rimMat = makeVaultMetalMaterial(EXIT_RIM_LOCKED, {
      metalness: 0.95,
      roughness: 0.28,
    });
    const trimMat = makeVaultMetalMaterial(0x9a7850, {
      metalness: 0.9,
      roughness: 0.36,
    });

    const door = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.1, 48),
      doorMat
    );
    door.name = "door";

    // Torus defaults to XY (hole along Z). Rotate so hole matches the door
    // cylinder axis (local Y) and the ring sits coplanar with the vault face.
    const frame = new THREE.Mesh(
      new THREE.TorusGeometry(r + 0.045, 0.055, 14, 48),
      rimMat
    );
    frame.name = "frame";
    frame.rotation.x = Math.PI / 2;

    // Concentric ribs on the door face.
    for (const ribR of [r * 0.72, r * 0.48]) {
      const rib = new THREE.Mesh(
        new THREE.TorusGeometry(ribR, 0.018, 8, 40),
        trimMat
      );
      rib.rotation.x = Math.PI / 2;
      rib.position.y = 0.055;
      face.add(rib);
    }

    // Rim bolts.
    const boltGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.07, 6);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const bolt = new THREE.Mesh(boltGeo, trimMat);
      bolt.position.set(
        Math.cos(a) * (r - 0.07),
        0.07,
        Math.sin(a) * (r - 0.07)
      );
      face.add(bolt);
    }

    // Center vault wheel.
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.17, 0.03, 10, 28),
      rimMat
    );
    wheel.rotation.x = Math.PI / 2;
    wheel.position.y = 0.08;
    face.add(wheel);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.035, 0.04),
        trimMat
      );
      spoke.position.y = 0.08;
      spoke.rotation.y = (i / 4) * Math.PI;
      face.add(spoke);
    }
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.09, 12),
      rimMat
    );
    hub.position.y = 0.09;
    face.add(hub);

    const doorFlame = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0xffdd66,
        emissive: 0xffaa33,
        emissiveIntensity: EXIT_LOCKED_EMISSIVE,
        toneMapped: false,
      })
    );
    doorFlame.position.set(0, 0.16, 0);
    doorFlame.name = "doorFlame";

    const doorBloom = new THREE.Group();
    doorBloom.name = "doorBloom";
    doorBloom.position.copy(doorFlame.position);
    for (const layer of LANTERN_BLOOM_LAYERS) {
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 10),
        new THREE.MeshBasicMaterial({
          color: 0xffc040,
          transparent: true,
          opacity: layer.opacity * 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })
      );
      orb.scale.set(layer.scaleX * 1.15, layer.scaleY * 1.15, layer.scaleX * 1.15);
      orb.renderOrder = 12;
      doorBloom.add(orb);
    }

    const doorGlow = new THREE.PointLight(0xffa040, 0.18, EXIT_GLOW_DISTANCE, 1.5);
    doorGlow.position.copy(doorFlame.position);
    doorGlow.name = "doorGlow";

    face.add(door, frame, doorFlame, doorBloom, doorGlow);
    g.add(face);
    scene.add(g);
    return g;
  }

  function syncEntities(data) {
    const { lanterns, shadows, exit } = data;

    while (lanternMeshes.length < lanterns.length) {
      lanternMeshes.push(createLanternGroup());
    }

    const lanternAnimTime = data.animTime || 0;

    // Hide extras when a later floor (more lanterns) returns to an earlier one.
    for (let i = lanterns.length; i < lanternMeshes.length; i++) {
      const extra = lanternMeshes[i];
      if (!extra) continue;
      extra.visible = false;
      const glow = extra.getObjectByName("glow");
      if (glow) glow.intensity = 0;
    }

    lanterns.forEach((lantern, i) => {
      const g = lanternMeshes[i];
      ensureLanternBody(g);
      g.visible = true;
      const base = {
        position: { x: lantern.x, y: 0, z: lantern.y },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
      applyPlacementFor(g, `lantern:${i}`, base);
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
      const sway = Math.sin(lanternAnimTime * 7.2 + i * 2.3) * 0.12;
      const sway2 = Math.sin(lanternAnimTime * 11.1 + i * 1.4) * 0.08;

      if (body) body.visible = true;
      if (flame) {
        flame.visible = lit;
        if (lit) {
          const core = flame.getObjectByName("flameCore");
          const flameBody = flame.getObjectByName("flameBody");
          const tip = flame.getObjectByName("flameTip");
          const stretchY = 1.12 + 0.38 * flicker;
          const stretchXZ = 0.88 + 0.14 * flicker;

          if (core?.material) {
            core.material.emissiveIntensity =
              LANTERN_FLAME_EMISSIVE * 1.15 * flicker;
            core.scale.setScalar(0.92 + 0.16 * flicker);
          }
          if (flameBody) {
            flameBody.scale.set(stretchXZ, stretchY, stretchXZ);
            flameBody.rotation.z = sway;
            flameBody.rotation.x = sway2 * 0.65;
            if (flameBody.material?.emissiveIntensity != null) {
              flameBody.material.emissiveIntensity =
                LANTERN_FLAME_EMISSIVE * flicker;
            }
          }
          if (tip) {
            tip.scale.set(
              0.85 + 0.2 * flicker,
              1.2 + 0.45 * flicker,
              0.85 + 0.2 * flicker
            );
            tip.position.y = 0.15 + 0.04 * flicker;
            tip.rotation.z = sway * 1.35;
            tip.rotation.x = sway2;
            if (tip.material) {
              tip.material.opacity = 0.55 + 0.3 * flicker;
            }
          }
        }
      }
      if (bloomOrbs) {
        bloomOrbs.visible = lit;
        if (lit) {
          bloomOrbs.scale.set(
            0.88 + 0.1 * flicker,
            0.95 + 0.22 * flicker,
            0.88 + 0.1 * flicker
          );
          bloomOrbs.rotation.z = sway * 0.5;
        }
      }
      if (glow) {
        glow.visible = lit;
        if (lit) {
          glow.intensity = LANTERN_GLOW_INTENSITY * flicker;
          _lanternGlowColor
            .copy(_lanternGlowWarm)
            .lerp(_lanternGlowHot, (flicker - 0.85) / 0.15);
          glow.color.copy(_lanternGlowColor);
        } else {
          glow.intensity = 0;
        }
      }
    });

    while (nullMeshes.length < shadows.length) {
      nullMeshes.push(null);
    }

    for (let i = shadows.length; i < nullMeshes.length; i++) {
      if (nullMeshes[i]) nullMeshes[i].visible = false;
    }

    shadows.forEach((shadow, i) => {
      const mesh = ensureNullMesh(i, shadow);
      if (!mesh) return;
      const bob = shadow.bob || 0;
      const base = {
        position: { x: shadow.x, y: bob + NULL_FLOAT_BASE_Y, z: shadow.y },
        rotation: { x: 0, y: shadow.faceAngle ?? 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
      applyPlacementFor(mesh, `null:${i}`, base);
      mesh.visible = true;
    });

    if (!exitMesh) {
      exitMesh = createExitGroup();
    }
    if (exit) {
      const animTime = data.animTime || 0;
      const exitBase = {
        position: { x: exit.x, y: 0, z: exit.y },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
      applyPlacementFor(exitMesh, "exit", exitBase);
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
        frame.material.color.setHex(
          unlocked ? EXIT_RIM_UNLOCKED : EXIT_RIM_LOCKED
        );
        frame.material.emissive.setHex(unlocked ? 0x5a3010 : 0x1a1008);
        frame.material.emissiveIntensity = unlocked ? 0.35 * pulse : 0.05;
      }
      if (door?.material) {
        door.material.color.setHex(
          unlocked ? EXIT_METAL_UNLOCKED : EXIT_METAL_LOCKED
        );
        door.material.emissive.setHex(unlocked ? 0xffa030 : 0x4a2810);
        door.material.emissiveIntensity = unlocked
          ? 0.85 * pulse
          : EXIT_LOCKED_EMISSIVE * pulse;
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

    const reach =
      data.torchReachScale != null && data.torchReachScale > 0
        ? data.torchReachScale
        : 1;

    torchLight.intensity = TORCH_BASE_INTENSITY + light * TORCH_LIGHT_INTENSITY;
    torchLight.distance =
      (TORCH_BASE_DISTANCE + light * TORCH_LIGHT_DISTANCE) * reach;
    torchLight.color.setRGB(1.0, 0.58 + light * 0.12, 0.22 + light * 0.08);

    const fogFar = (6.5 + light * 6) * reach;
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
    getEditorApi() {
      return {
        scene,
        camera,
        renderer,
        domElement: canvas,
        listTargets() {
          const targets = [];
          for (let i = 0; i < lanternMeshes.length; i++) {
            if (lanternMeshes[i]?.visible) {
              targets.push({
                id: `lantern:${i}`,
                label: `Lantern ${i + 1}`,
                scene: "world",
              });
            }
          }
          for (let i = 0; i < nullMeshes.length; i++) {
            if (nullMeshes[i]?.visible) {
              targets.push({
                id: `null:${i}`,
                label: `Null ${i + 1}`,
                scene: "world",
              });
            }
          }
          if (exitMesh) {
            targets.push({ id: "exit", label: "Exit vault door", scene: "world" });
          }
          return targets;
        },
        getObject(id) {
          if (id === "exit") return exitMesh;
          if (id.startsWith("lantern:")) {
            const i = Number(id.slice(8));
            return lanternMeshes[i] || null;
          }
          if (id.startsWith("null:")) {
            const i = Number(id.slice(5));
            return nullMeshes[i] || null;
          }
          return null;
        },
      };
    },
    // Rebuild shell after maze regen. Pass new map/dims when the grid size changes
    // (Level 2+); same-size regenerations can omit args and mutate levelMap in place.
    rebuildLevel(opts = {}) {
      if (opts.levelMap) levelMap = opts.levelMap;
      if (opts.mapRows != null) mapRows = opts.mapRows;
      if (opts.mapCols != null) mapCols = opts.mapCols;
      shell.rebuildLevel({
        levelMap,
        mapRows,
        mapCols,
      });
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

  // Floor is generated rather than loaded: a seamless cracked-flagstone tile
  // with crystal light in the cracks. Keeps the path visually distinct from the
  // crystal walls, and tiles without the seams a photo texture leaves behind.
  // Both axes use the same divisor so slabs stay square instead of stretching.
  const floorTex = makeTiledTexture(createStonePathCanvas(), {
    x: Math.max(2, mapCols / FLOOR_TILE_WORLD_UNITS),
    y: Math.max(2, mapRows / FLOOR_TILE_WORLD_UNITS),
  });
  shell.setFloorTexture(floorTex);
  shell.textures.push(floorTex);
  console.log("[world3d] stone path floor generated");

  loader.load(
    CAVE_ENV_URL,
    (loadedTex) => {
      const ceilingTex = makeCroppedTexture(loadedTex.image, CAVE_CROPS.ceiling, {
        x: Math.max(2.2, mapCols / 4.5),
        y: Math.max(1.6, mapRows / 3.2),
      });
      loadedTex.dispose();

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

function buildShell(scene, initialMap, initialRows, initialCols) {
  const textures = [];
  let ceilingMesh = null;
  let floorMesh = null;
  let levelMap = initialMap;
  let mapRows = initialRows;
  let mapCols = initialCols;
  const wallMeshes = [];
  const wallFallbackMat = new THREE.MeshStandardMaterial({
    color: 0x5a5078,
    roughness: ENV_WALL_ROUGHNESS,
    metalness: ENV_WALL_METALNESS,
    side: THREE.DoubleSide,
  });

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x9088a8,
    roughness: ENV_FLOOR_ROUGHNESS,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const ceilMat = new THREE.MeshStandardMaterial({
    color: 0xc8c0d8,
    roughness: ENV_CEIL_ROUGHNESS,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  function makeFloorGeo(cols, rows) {
    const geo = new THREE.PlaneGeometry(cols, rows);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }

  function makeCeilGeo(cols, rows) {
    const geo = new THREE.PlaneGeometry(cols, rows);
    geo.rotateX(Math.PI / 2);
    return geo;
  }

  floorMesh = new THREE.Mesh(makeFloorGeo(mapCols, mapRows), floorMat);
  floorMesh.position.set(mapCols * 0.5, 0.02, mapRows * 0.5);
  scene.add(floorMesh);

  ceilingMesh = new THREE.Mesh(makeCeilGeo(mapCols, mapRows), ceilMat);
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

  function resizeShellPlanes() {
    if (floorMesh) {
      floorMesh.geometry?.dispose?.();
      floorMesh.geometry = makeFloorGeo(mapCols, mapRows);
      floorMesh.position.set(mapCols * 0.5, 0.02, mapRows * 0.5);
    }
    if (ceilingMesh) {
      ceilingMesh.geometry?.dispose?.();
      ceilingMesh.geometry = makeCeilGeo(mapCols, mapRows);
      ceilingMesh.position.set(mapCols * 0.5, CEILING_HEIGHT, mapRows * 0.5);
    }
  }

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
    if (!baseTextures.length) return;

    const seed =
      (mapCols * 73856093) ^
      (mapRows * 19349663) ^
      (wallMeshes.length * 83492791) ^
      ((Math.random() * 0xffffffff) >>> 0);
    assignWallTextureIndices(wallMeshes, baseTextures.length, seed);

    for (const group of wallMeshes) {
      const col = group.userData.wallCol;
      const row = group.userData.wallRow;
      const idx =
        group.userData.wallTexIdx != null
          ? group.userData.wallTexIdx
          : (col * 13 + row * 7) % baseTextures.length;
      const tex = baseTextures[idx].clone();
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(WALL_TEX_REPEAT_U, WALL_TEX_REPEAT_V);
      // Slight per-cell crop so non-adjacent repeats of the same plate still vary.
      const jitter = ((col * 17 + row * 31) % 100) / 100;
      tex.offset.set(
        (jitter * (1 - WALL_TEX_REPEAT_U)) % 1,
        (((col + row) * 0.37) % 1) * (1 - WALL_TEX_REPEAT_V)
      );
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
    rebuildLevel(opts = {}) {
      if (opts.levelMap) levelMap = opts.levelMap;
      const nextRows = opts.mapRows != null ? opts.mapRows : mapRows;
      const nextCols = opts.mapCols != null ? opts.mapCols : mapCols;
      const sizeChanged = nextRows !== mapRows || nextCols !== mapCols;
      mapRows = nextRows;
      mapCols = nextCols;
      if (sizeChanged) resizeShellPlanes();
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
        color: ENV_FLOOR_TINT,
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
      ceilingMesh?.geometry?.dispose?.();
      if (gridLines) {
        scene.remove(gridLines);
        gridLines.geometry?.dispose?.();
      }
    },
  };
}
