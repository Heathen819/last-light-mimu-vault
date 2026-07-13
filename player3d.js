/* ============================================
   First-person 3D player overlay (Three.js)
   Banker avatar with built-in torch + flame glow
   ============================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/** Layer mask — only meshes on this layer feed the bloom pass. */
const BLOOM_LAYER = 1;

const SELECTIVE_BLOOM_MIX_SHADER = {
  uniforms: {
    baseTexture: { value: null },
    bloomTexture: { value: null },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D baseTexture;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(baseTexture, vUv);
      vec4 bloom = texture2D(bloomTexture, vUv);
      float bloomLum = max(bloom.r, max(bloom.g, bloom.b));
      float alpha = max(base.a, smoothstep(0.015, 0.1, bloomLum * (1.0 - base.a * 0.35)));
      gl_FragColor = vec4(base.rgb + bloom.rgb, alpha);
    }`,
};

const MODEL_URL = "assets/player/banker_torch_animated_18.glb";
/** Neutral cone-flame emissive (orange torch crystal). */
const NEUTRAL_FLAME_EMISSIVE = { r: 1.0, g: 0.42, b: 0.08 };
/** Avatar GLB includes torch mesh on the raised arm (R_Forearm / R_Hand rig). */
const USE_EXTERNAL_TORCH = false;
const TORCH_URL = "torch_flame_animation_2.0.glb";
const FLAME_SHEET_BASE = {
  planeW: 0.28,
  planeH: 0.46,
  scale: 1.18,
};
const FLAME_DIAMOND_SCALE = 0.8;
const FLAME_DIAMOND_OPACITY = 0.2;

/**
 * Bloom orbs follow screen anchor K4 (star on torch tip). Torch tip is depth reference only.
 */
const BLOOM_TORCH_LOCK = {
  screen: { x: 476 / 752, y: 225 / 553 },
  nudgePx: { x: 0, y: 0 },
  pass: { strength: 0.26, radius: 0.42, threshold: 0.3 },
  orbs: { enabled: false, neutralGain: 0.82 },
  quality: { strength: 1.45, radius: 0.42, threshold: 0.34 },
  gridCell: "K4",
};

/** Selective GPU bloom — only torch/crystal meshes bloom; overlay stays transparent. */
const USE_3D_BLOOM = true;
const BLOOM_PASS = { ...BLOOM_TORCH_LOCK.pass };
/** Small emissive orbs at the flame — feed the bloom pass. */
const BLOOM_ORB_ENABLED = BLOOM_TORCH_LOCK.orbs.enabled;
const NEUTRAL_BLOOM_GAIN = BLOOM_TORCH_LOCK.orbs.neutralGain;

const BLOOM_SCREEN_DEFAULT = { ...BLOOM_TORCH_LOCK.screen };
/** Fine pixel nudge on top of bloom screen anchor (negative x = left). */
const BLOOM_SCREEN_NUDGE_PX = { ...BLOOM_TORCH_LOCK.nudgePx };

const BLOOM_GAIN = 0.88;

const DEFAULT_BLOOM = { ...BLOOM_TORCH_LOCK.quality };

const CUE_BLOOM_LAYER_DEFS = [
  { scale: 0.045, opacity: 0.2 },
  { scale: 0.075, opacity: 0.09 },
  { scale: 0.11, opacity: 0.04 },
];

/** Raise avatar in the viewport (world Y). */
const AVATAR_VIEW_Y_LIFT = 0.05;
const AVATAR_BURY_RATIO = 0.58;
/** Rig idle plays in GLB — keep slow; full speed looked jittery on v3. */
const AVATAR_ANIM_TIME_SCALE = 0.35;
/** Reduce procedural walk-bob when a skeletal idle is already running. */
const ANIMATED_AVATAR_BOB_MUL = 0.3;
/** Subtle procedural idle (used while standing still) — gentle "alive" motion.
 *  Independent of the skeletal rig, so it never affects the locked bloom/torch. */
const IDLE_BREATHE_SPEED = 1.6; // vertical breathe frequency
const IDLE_BREATHE_AMP = 0.006; // vertical breathe amount (world Y)
const IDLE_SWAY_SPEED = 0.9; // side-lean frequency
const IDLE_SWAY_AMP = 0.01; // side-lean amount (radians)
const IDLE_YAW_SPEED = 0.6; // slow turn-drift frequency
const IDLE_YAW_AMP = 0.008; // slow turn-drift amount (radians)

/** Screen-space offset for the 3D diamond flame sprite (px). Negative x = left. */
const FLAME_SPRITE_NUDGE_PX = { x: 0, y: 50 };
/** Nudge flame sprite toward torch on world Z (px at flame depth). */
const FLAME_SPRITE_Z_NUDGE_PX = 20;
/** When false, flame sprite stays on the torch crystal instead of the screen anchor. */
const FLAME_SPRITE_LOCK_TO_BLOOM = false;
/** Fine-tune only if ember mesh scan is slightly off (torch local space). */
const FLAME_LOCAL_OFFSET = { x: 0, y: 0, z: 0 };
/** Screen-space bias — keep at zero; glow tracks projected ember anchor. */
const FLAME_SCREEN_BIAS = { x: 0, y: 0 };

/** Viewport-normalized point-light anchor (between F4 & G4). */
const POINT_LIGHT_SCREEN = { x: 0.359, y: 0.25 };
/** Mini lantern-style torch head — lantern brightness, smaller footprint. */
const TORCH_HEAD_LANTERN_SCALE = 0.42;
const TORCH_HEAD_LANTERN = {
  flameRadius: 0.085 * TORCH_HEAD_LANTERN_SCALE,
  flameEmissive: 2.6,
  glowIntensity: 2.2,
  glowDistance: 6.5,
  bloomLayers: [
    { scale: 0.1 * TORCH_HEAD_LANTERN_SCALE, opacity: 0.936 },
    { scale: 0.17 * TORCH_HEAD_LANTERN_SCALE, opacity: 0.442 },
    { scale: 0.26 * TORCH_HEAD_LANTERN_SCALE, opacity: 0.182 },
  ],
};

export function createPlayer3D(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, 960 / 540, 0.05, 20);
  camera.position.set(0.4, 1.2, 0.9);
  camera.lookAt(0.3, 1.1, 0);
  camera.layers.enable(BLOOM_LAYER);

  const hemi = new THREE.HemisphereLight(0xffc890, 0x0a0608, 0.06);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffa860, 0.04);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xffb060, 0.14);
  key.position.set(0.6, 2.0, 1.2);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x664430, 0.03);
  rim.position.set(-1.0, 1.2, -0.5);
  scene.add(rim);

  const warmLight = new THREE.PointLight(0xff7820, 0.65, 2.2, 1.6);
  warmLight.position.set(0.15, 0.95, 0.35);
  scene.add(warmLight);

  const torchHeadLight = new THREE.PointLight(0xffc050, 0, TORCH_HEAD_LANTERN.glowDistance, 1.45);
  scene.add(torchHeadLight);

  const flameLight = new THREE.PointLight(0xffa028, 3.8, 6.5, 1.2);
  flameLight.position.set(0.4, 1.25, 0.3);
  scene.add(flameLight);

  // Blue reads much darker than red at equal intensity — boost blue-cue lights.
  const BLUE_CUE_LIGHT_GAIN = 2.4;
  // Bright blue/red signal light — only at the torch flame on direction cues
  const signalLight = new THREE.PointLight(0x4488ff, 0, 7, 1.0);
  signalLight.position.set(0.4, 1.25, 0.3);
  scene.add(signalLight);

  const flameAnchor = new THREE.Group();
  const root = new THREE.Group();
  scene.add(root);
  root.add(flameAnchor);

  const bloomScreen = { ...BLOOM_SCREEN_DEFAULT };
  const bloomScreenNudgePx = { ...BLOOM_SCREEN_NUDGE_PX };

  const bloomLayerMask = new THREE.Layers();
  bloomLayerMask.set(BLOOM_LAYER);
  const bloomDarkMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const bloomSavedMaterials = {};

  function tagBloomLayer(obj) {
    obj.layers.enable(BLOOM_LAYER);
  }

  /** Hidden bloom-only helpers — not used; cone emissive feeds bloom instead. */
  function tagBloomOrb(obj) {
    obj.layers.set(BLOOM_LAYER);
  }

  /** Crystal / flame meshes bloom while staying visible on the default layer. */
  function tagBloomFeed(obj) {
    obj.layers.enable(BLOOM_LAYER);
  }

  const bloomLayers = [];
  const cueBloomLayers = [];

  let bloomFeedPlane = null;
  let bloomFeedMat = null;
  let torchHeadBloomGroup = null;
  let torchHeadFlame = null;
  const torchHeadBloomOrbs = [];

  function createBloomFeedPlane() {
    bloomFeedMat = new THREE.MeshBasicMaterial({
      color: 0xffa028,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    bloomFeedPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.085), bloomFeedMat);
    bloomFeedPlane.renderOrder = 19;
    bloomFeedPlane.frustumCulled = false;
    tagBloomOrb(bloomFeedPlane);
  }

  createBloomFeedPlane();

  function createTorchHeadLanternGlow() {
    torchHeadBloomGroup = new THREE.Group();
    torchHeadBloomGroup.visible = false;
    torchHeadBloomGroup.frustumCulled = false;

    torchHeadFlame = new THREE.Mesh(
      new THREE.SphereGeometry(TORCH_HEAD_LANTERN.flameRadius, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0xffdd66,
        emissive: 0xffaa33,
        emissiveIntensity: TORCH_HEAD_LANTERN.flameEmissive,
        toneMapped: false,
      })
    );
    torchHeadFlame.renderOrder = 20;
    torchHeadFlame.frustumCulled = false;
    tagBloomFeed(torchHeadFlame);
    torchHeadBloomGroup.add(torchHeadFlame);

    for (const layer of TORCH_HEAD_LANTERN.bloomLayers) {
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
      orb.renderOrder = 19;
      orb.frustumCulled = false;
      tagBloomOrb(orb);
      torchHeadBloomGroup.add(orb);
      torchHeadBloomOrbs.push({ mesh: orb, def: layer });
    }
  }

  createTorchHeadLanternGlow();

  function darkenNonBloomed(obj) {
    if (!obj.isMesh || bloomLayerMask.test(obj.layers)) return;
    if (bloomSavedMaterials[obj.uuid]) return;
    bloomSavedMaterials[obj.uuid] = obj.material;
    obj.material = bloomDarkMaterial;
  }

  function restoreNonBloomed(obj) {
    if (!bloomSavedMaterials[obj.uuid]) return;
    obj.material = bloomSavedMaterials[obj.uuid];
    delete bloomSavedMaterials[obj.uuid];
  }

  const bloom = { ...DEFAULT_BLOOM };
  let bloomStrengthMul = 1;

  let bloomComposer = null;
  let finalComposer = null;
  let bloomMixPass = null;
  let bloomPass = null;

  function syncBloomPass() {
    if (!bloomPass) return;
    bloomPass.strength = BLOOM_PASS.strength * bloom.strength * bloomStrengthMul;
    bloomPass.radius = BLOOM_PASS.radius * (bloom.radius / DEFAULT_BLOOM.radius);
    bloomPass.threshold = BLOOM_PASS.threshold + (bloom.threshold - DEFAULT_BLOOM.threshold);
  }

  function createRenderPass() {
    const pass = new RenderPass(scene, camera);
    pass.clearColor = new THREE.Color(0x000000);
    pass.clearAlpha = 0;
    return pass;
  }

  if (USE_3D_BLOOM) {
    const w = Math.max(1, canvas.width || 960);
    const h = Math.max(1, canvas.height || 540);

    bloomComposer = new EffectComposer(renderer);
    bloomComposer.renderToScreen = false;
    bloomComposer.addPass(createRenderPass());
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      BLOOM_PASS.strength,
      BLOOM_PASS.radius,
      BLOOM_PASS.threshold
    );
    bloomComposer.addPass(bloomPass);

    bloomMixPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(SELECTIVE_BLOOM_MIX_SHADER.uniforms),
        vertexShader: SELECTIVE_BLOOM_MIX_SHADER.vertexShader,
        fragmentShader: SELECTIVE_BLOOM_MIX_SHADER.fragmentShader,
      }),
      "baseTexture"
    );
    bloomMixPass.needsSwap = true;

    finalComposer = new EffectComposer(renderer);
    finalComposer.renderToScreen = true;
    finalComposer.addPass(createRenderPass());
    finalComposer.addPass(bloomMixPass);
    finalComposer.addPass(new OutputPass());
    syncBloomPass();
  }

  let model = null;
  let torchRoot = null;
  let builtinTorchNode = null;
  let builtinFlameMesh = null;
  let emberAnchorNode = null;
  let useGlbFlame = false;
  let useBuiltinConeFlame = false;
  let builtinConeFlames = [];
  let bloomFeedMesh = null;
  let torchFlameSphere = null;
  let mixer = null;
  let avatarAction = null;
  let idlePhase = 0; // accumulates dt for the procedural idle sway
  let ready = false;
  let loadError = null;
  let torchSide = "Right";
  const glowMaterials = [];
  const clock = new THREE.Clock();
  const flameTint = new THREE.Color(1, 0.63, 0.16);
  const warmTint = new THREE.Color(1, 0.48, 0.12);
  const spriteTint = new THREE.Color(1, 1, 1);
  let flameSprite = null;
  let flameBloomSprite = null;
  let flameSpriteMat = null;
  let flameBloomSpriteMat = null;
  let flameAnimTime = 0;
  let glbFlameMat = null;
  let flameAttached = false;
  const flamePlaneGeoCache = {};
  const _tipPos = new THREE.Vector3();
  const _glowBox = new THREE.Box3();
  const _emberLocal = new THREE.Vector3();
  const _emberWorld = new THREE.Vector3();
  const _meshWorld = new THREE.Matrix4();
  const _proj = new THREE.Vector3();
  const _unproj = new THREE.Vector3();
  const _camDir = new THREE.Vector3();
  const _bloomPos = new THREE.Vector3();
  const _torchHeadPos = new THREE.Vector3();
  const _bloomScreen = { x: 0, y: 0 };
  const _headQuat = new THREE.Quaternion();
  const _headFwd = new THREE.Vector3();
  const _headBack = new THREE.Vector3();
  const _handInv = new THREE.Matrix4();
  const _torchLocalMat = new THREE.Matrix4();
  let flameScreenX = POINT_LIGHT_SCREEN.x;
  let flameScreenY = POINT_LIGHT_SCREEN.y;
  let spriteScreenX = POINT_LIGHT_SCREEN.x;
  let spriteScreenY = POINT_LIGHT_SCREEN.y;

  const pose = {
    x: 0,
    y: 0,
    z: 0,
    scale: 1.2,
    yaw: Math.PI / 2,
  };
  let avatarLowerY = 0;

  function findIn(root, exactOrPart) {
    if (!root) return null;
    let exact = null;
    let partial = null;
    const needle = exactOrPart.toLowerCase();
    root.traverse((obj) => {
      const n = (obj.name || "").toLowerCase();
      if (!n) return;
      if (n === needle) exact = obj;
      else if (!partial && n.includes(needle)) partial = obj;
    });
    return exact || partial;
  }

  function findNamed(exactOrPart) {
    return findIn(model, exactOrPart);
  }

  function boneWorld(name) {
    const b = findNamed(name);
    if (!b) return null;
    const v = new THREE.Vector3();
    b.getWorldPosition(v);
    return v;
  }

  function handBone(side = torchSide) {
    const prefix = side === "Right" ? "R" : "L";
    return (
      findNamed(`${prefix}_Hand`) ||
      findNamed(`mixamorig:${side}Hand`) ||
      findNamed(`${side}Hand`)
    );
  }

  function findBuiltinTorch() {
    if (!model) return null;

    function torchInSiblings(handBone) {
      if (!handBone) return null;
      for (const child of handBone.children) {
        if (/tripo_node/i.test(child.name || "")) return child;
      }
      const limb = handBone.parent;
      if (limb) {
        for (const child of limb.children) {
          if (/tripo_node/i.test(child.name || "")) return child;
        }
      }
      return null;
    }

    const rightTorch = torchInSiblings(findNamed("R_Hand"));
    if (rightTorch) return rightTorch;

    const leftTorch = torchInSiblings(findNamed("L_Hand"));
    if (leftTorch) return leftTorch;

    let fallback = null;
    model.traverse((obj) => {
      if (!/tripo_node/i.test(obj.name || "")) return;
      const parentName = obj.parent?.name || "";
      if (/^armature$/i.test(parentName)) return;
      if (/forearm|hand|upperarm|clavicle/i.test(parentName)) fallback = obj;
    });
    return fallback;
  }

  function isTorchFlamePart(name) {
    const n = (name || "").toLowerCase();
    return /^object_/i.test(n) || /^flame/i.test(n) || /^cone/i.test(n);
  }

  function prepareBuiltinTorchMaterials() {
    if (!builtinTorchNode) return;
    builtinTorchNode.traverse((obj) => {
      if (!obj.isMesh) return;
      const n = (obj.name || "").toLowerCase();
      if (isTorchFlamePart(n) || /^cylinder/i.test(n)) return;
      const src = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      const mat = new THREE.MeshStandardMaterial({
        map: src?.map || null,
        normalMap: src?.normalMap || null,
        roughnessMap: src?.roughnessMap || null,
        metalnessMap: src?.metalnessMap || null,
        color: new THREE.Color(0.28, 0.22, 0.18),
        emissive: new THREE.Color(0.2, 0.1, 0.03),
        emissiveIntensity: 0.32,
        roughness: 0.9,
        metalness: 0.06,
      });
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      obj.material = mat;
    });
  }

  function sanitizeExtraSceneRoots() {
    if (!model) return;
    for (const child of model.children) {
      const name = child.name || "";
      if (/^sketchfab_model/i.test(name) || /^flame waver$/i.test(name)) {
        child.visible = false;
      }
    }
  }

  function createGlbFlameMaterial(map) {
    if (!map) return null;
    map.colorSpace = THREE.SRGBColorSpace;

    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map },
        time: { value: 0 },
        flameMode: { value: 0 },
        opacity: { value: 1 },
        light: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform float time;
        uniform float flameMode;
        uniform float opacity;
        uniform float light;
        varying vec2 vUv;

        vec3 tintOrange(vec3 c) {
          return c * vec3(1.18, 0.92, 0.48);
        }

        vec3 tintBlue(vec3 c) {
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          return mix(vec3(0.03, 0.1, 0.24), vec3(0.42, 0.68, 1.0), clamp(l * 1.35, 0.0, 1.0));
        }

        vec3 tintRed(vec3 c) {
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          return mix(vec3(0.18, 0.03, 0.03), vec3(1.0, 0.32, 0.08), clamp(l * 1.25, 0.0, 1.0));
        }

        void main() {
          vec2 uv = vUv;

          vec2 noiseUv = vec2(uv.x + 0.52, fract(uv.y * 1.2 - time * 1.4));
          vec3 noise = texture2D(map, clamp(noiseUv, vec2(0.52, 0.02), vec2(0.99, 0.99))).rgb;
          float n = noise.r * 0.58 + noise.g * 0.3 + noise.b * 0.12;

          float sway = (n - 0.5) * 0.1 * (0.25 + uv.y * 0.85);
          float lift = (n - 0.5) * 0.035;
          float flicker = 0.86 + 0.14 * sin(time * 10.0 + uv.y * 16.0 + n * 6.283);

          vec2 flameUv = vec2(uv.x + sway, uv.y + lift);
          vec4 tex = texture2D(map, clamp(flameUv, vec2(0.01, 0.06), vec2(0.49, 0.99)));

          vec3 col = tex.rgb;
          if (flameMode < 0.5) col = tintOrange(col);
          else if (flameMode < 1.5) col = tintBlue(col);
          else col = tintRed(col);

          float cueBoost = flameMode > 0.5 ? 1.28 : 1.12;
          col *= (1.02 + 0.34 * light) * flicker * cueBoost;

          float alpha = tex.a * opacity * flicker * 1.32;
          if (alpha < 0.008) discard;
          gl_FragColor = vec4(col, min(alpha, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
  }

  function configureFlameMeshMaterial(mesh) {
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!src) return;

    const prev = mesh.material;
    glbFlameMat = createGlbFlameMaterial(src.map);
    if (glbFlameMat) {
      mesh.material = glbFlameMat;
      if (prev && prev !== glbFlameMat) prev.dispose?.();
    } else if (src.map) {
      src.map.colorSpace = THREE.SRGBColorSpace;
      src.transparent = true;
      src.depthWrite = false;
      src.toneMapped = false;
      src.side = THREE.DoubleSide;
      if (!src.emissive) src.emissive = new THREE.Color(1, 0.72, 0.28);
      src.emissiveIntensity = 1.05;
      src.needsUpdate = true;
      glbFlameMat = null;
    }

    mesh.renderOrder = 32;
    mesh.frustumCulled = false;
    if (!mesh.userData.baseScale) {
      mesh.userData.baseScale = mesh.scale.clone();
    }
  }

  function setupBuiltinTorchFlame() {
    builtinFlameMesh = null;
    emberAnchorNode = null;
    useGlbFlame = false;
    useBuiltinConeFlame = false;
    builtinConeFlames = [];
    if (!builtinTorchNode) return;

    builtinTorchNode.traverse((obj) => {
      const n = (obj.name || "").toLowerCase();
      const mname = (obj.material?.name || "").toLowerCase();

      if (/icosphere/i.test(n)) {
        emberAnchorNode = obj;
        obj.visible = false;
        return;
      }

      if (obj.isMesh && /^cone/i.test(n)) {
        builtinConeFlames.push(obj);
        useBuiltinConeFlame = true;
        obj.visible = true;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          m.transparent = true;
          m.depthWrite = false;
          m.toneMapped = false;
          if (!m.emissive) {
            m.emissive = new THREE.Color(
              NEUTRAL_FLAME_EMISSIVE.r,
              NEUTRAL_FLAME_EMISSIVE.g,
              NEUTRAL_FLAME_EMISSIVE.b
            );
          }
          m.emissiveIntensity = 1.2;
          m.needsUpdate = true;
        }
        return;
      }

      if (obj.isMesh && /^cylinder/i.test(n)) {
        obj.visible = false;
        return;
      }

      if (obj.isMesh && (/^object_/i.test(n) || /^flame/i.test(n))) {
        builtinFlameMesh = obj;
        tagBloomLayer(obj);
        configureFlameMeshMaterial(obj);
        obj.visible = true;
        return;
      }

      if (!obj.isMesh) return;
      if (/flame|fire|glow|ember|wick/i.test(n) || /flame|fire|glow|ember/i.test(mname)) {
        if (obj !== builtinFlameMesh) obj.visible = false;
      }
    });

    if (useBuiltinConeFlame && builtinConeFlames.length) {
      const sortedFlames = [...builtinConeFlames].sort(
        (a, b) => b.position.y - a.position.y
      );
      const flameCone = sortedFlames[1] || sortedFlames[0];
      for (const mesh of builtinConeFlames) {
        mesh.userData.flameActive = false;
        mesh.visible = false;
      }
      emberAnchorNode = flameCone;
      bloomFeedMesh = emberAnchorNode;
      if (flameSprite) {
        flameSprite.visible = false;
        flameSprite.removeFromParent();
      }
      if (flameBloomSprite) {
        flameBloomSprite.visible = false;
        flameBloomSprite.removeFromParent();
      }
    }

    useGlbFlame = !!builtinFlameMesh;
  }

  function hideBuiltinTorchFlameMeshes() {
    setupBuiltinTorchFlame();
  }

  function findTorchEmberObject(torchParent) {
    if (!torchParent) return null;
    const patterns = [
      /^icosphere/i,
      /^flame_anchor$/i,
      /^ember(_point|_anchor)?$/i,
      /^wick$/i,
      /^sphere$/i,
      /^tri_glow$/i,
      /^cone/i,
    ];
    let found = null;
    torchParent.traverse((obj) => {
      if (found || obj === torchParent) return;
      const name = obj.name || "";
      if (patterns.some((re) => re.test(name))) found = obj;
    });
    return found;
  }

  /** Centroid of the highest torch vertices — stable ember point without manual offsets. */
  function computeEmberLocalPosition(torchParent, sourceNode = torchParent) {
    if (!torchParent || !sourceNode) return null;

    sourceNode.updateMatrixWorld(true);
    torchParent.updateMatrixWorld(true);
    const inv = torchParent.matrixWorld.clone().invert();

    const box = new THREE.Box3().setFromObject(sourceNode);
    if (box.isEmpty()) return null;

    const size = new THREE.Vector3();
    box.getSize(size);
    const bandMinY = box.max.y - Math.max(size.y * 0.14, 0.018);

    const sum = new THREE.Vector3();
    let count = 0;
    const v = new THREE.Vector3();

    sourceNode.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
      const pos = obj.geometry.attributes.position;
      _meshWorld.copy(obj.matrixWorld);
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(_meshWorld);
        v.applyMatrix4(inv);
        if (v.y < bandMinY) continue;
        sum.add(v);
        count += 1;
      }
    });

    if (count > 0) {
      return sum.multiplyScalar(1 / count);
    }

    _emberLocal.set(
      (box.min.x + box.max.x) * 0.5,
      box.max.y - size.y * 0.06,
      (box.min.z + box.max.z) * 0.5
    );
    return _emberLocal;
  }

  function resolveFlameLocalPosition(parent, sourceNode) {
    const emberObj = findTorchEmberObject(sourceNode || parent);
    if (emberObj) {
      parent.updateMatrixWorld(true);
      emberObj.updateMatrixWorld(true);
      _emberWorld.setFromMatrixPosition(emberObj.matrixWorld);
      _emberLocal.copy(_emberWorld);
      parent.worldToLocal(_emberLocal);
      _emberLocal.x += FLAME_LOCAL_OFFSET.x;
      _emberLocal.y += FLAME_LOCAL_OFFSET.y;
      _emberLocal.z += FLAME_LOCAL_OFFSET.z;
      return _emberLocal.clone();
    }

    const computed = computeEmberLocalPosition(parent, sourceNode || parent);
    if (!computed) return null;
    computed.x += FLAME_LOCAL_OFFSET.x;
    computed.y += FLAME_LOCAL_OFFSET.y;
    computed.z += FLAME_LOCAL_OFFSET.z;
    return computed;
  }

  function hideBuiltinTorch() {
    const builtin = findBuiltinTorch();
    if (builtin) builtin.visible = false;
    const glow = findNamed("TRI_GLOW");
    if (glow) glow.visible = false;
    hideBuiltinTorchFlameMeshes();
  }

  function setupTorchMeshes(torchScene) {
    torchScene.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.frustumCulled = false;
      obj.castShadow = false;
      obj.receiveShadow = false;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.side = THREE.DoubleSide;
        m.depthWrite = true;
        m.needsUpdate = true;
      }
      if (/^sphere$/i.test(obj.name || "")) {
        torchFlameSphere = obj;
        obj.visible = false;
      }
    });
  }

  function attachExternalTorch() {
    if (!model || !torchRoot) return false;
    const hand = handBone();
    const builtin = findBuiltinTorch();
    if (!hand || !builtin) return false;

    model.updateMatrixWorld(true);
    builtin.updateMatrixWorld(true);
    hand.updateMatrixWorld(true);

    _handInv.copy(hand.matrixWorld).invert();
    _torchLocalMat.multiplyMatrices(_handInv, builtin.matrixWorld);
    _torchLocalMat.decompose(
      torchRoot.position,
      torchRoot.quaternion,
      torchRoot.scale
    );

    hand.add(torchRoot);
    hideBuiltinTorch();
    return true;
  }

  function detectTorchSide() {
    const builtin = findBuiltinTorch();
    if (builtin?.parent?.name) {
      const limbName = builtin.parent.name.toLowerCase();
      torchSide =
        limbName.includes("r_") || limbName.includes("right") ? "Right" : "Left";
      return;
    }
    const rh =
      boneWorld("R_Hand") ||
      boneWorld("mixamorig:RightHand") ||
      boneWorld("RightHand");
    const lh =
      boneWorld("L_Hand") ||
      boneWorld("mixamorig:LeftHand") ||
      boneWorld("LeftHand");
    if (rh && lh) torchSide = rh.y >= lh.y ? "Right" : "Left";
  }

  function createFlameSpriteMaterial(glowPass = 0) {
    return new THREE.ShaderMaterial({
      uniforms: {
        flameMode: { value: 0 },
        opacity: { value: 1 },
        glowPass: { value: glowPass },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float flameMode;
        uniform float opacity;
        uniform float glowPass;
        uniform float time;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

          vec3 paletteOrange(float t) {
          vec3 deep = vec3(0.5, 0.1, 0.02);
          vec3 body = vec3(1.0, 0.42, 0.06);
          vec3 core = vec3(1.0, 0.88, 0.38);
          vec3 c = mix(deep, body, smoothstep(0.0, 0.58, t));
          return mix(c, core, smoothstep(0.32, 1.0, t));
        }

        vec3 paletteBlue(float t) {
          vec3 deep = vec3(0.01, 0.04, 0.18);
          vec3 body = vec3(0.08, 0.28, 0.78);
          vec3 core = vec3(0.45, 0.72, 1.0);
          vec3 c = mix(deep, body, smoothstep(0.0, 0.58, t));
          return mix(c, core, smoothstep(0.35, 1.0, t));
        }

        vec3 paletteRed(float t) {
          vec3 deep = vec3(0.2, 0.02, 0.03);
          vec3 body = vec3(0.88, 0.1, 0.04);
          vec3 core = vec3(1.0, 0.42, 0.1);
          vec3 c = mix(deep, body, smoothstep(0.0, 0.58, t));
          return mix(c, core, smoothstep(0.38, 1.0, t));
        }

        void main() {
          vec2 uv = vUv;
          float t = time;

          float sway = (noise(vec2(uv.y * 4.5, t * 2.8)) - 0.5) * 0.08;
          uv.x += sway * (1.0 - glowPass);

          vec2 p = uv - vec2(0.5, 0.5);
          float edge = abs(p.x) * 2.35 + abs(p.y) * 1.65;
          float shape = smoothstep(1.04, 0.74, edge);
          shape *= 0.9 + 0.1 * sin(t * 11.0 + uv.y * 9.0);
          shape += 0.05 * shape * noise(vec2(uv.x * 10.0, t * 4.0));

          float heat = shape * smoothstep(1.0, 0.12, edge);
          heat = pow(clamp(heat, 0.0, 1.0), 0.72);
          float alpha = shape * opacity * 1.35;

          vec3 col;
          if (flameMode < 0.5) col = paletteOrange(heat) * (0.95 + 0.42 * heat);
          else if (flameMode < 1.5) col = paletteBlue(heat) * (1.0 + 0.45 * heat);
          else col = paletteRed(heat) * (0.95 + 0.42 * heat);

          if (glowPass > 0.5) {
            col *= 0.88;
            alpha *= 0.52;
          }

          if (alpha < 0.008) discard;
          gl_FragColor = vec4(col, min(alpha, 1.0));
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }

  function setFlameMode(mat, mode, opacity, time = 0) {
    if (!mat?.uniforms) return;
    mat.uniforms.flameMode.value = mode;
    mat.uniforms.opacity.value = opacity;
    mat.uniforms.time.value = time;
  }

  function attachFlameToTorch() {
    if (!flameAnchor || flameAttached || !model) return false;

    model.updateMatrixWorld(true);
    let parent = null;
    let localPos = null;

    if (torchRoot) {
      parent = torchRoot;
      localPos = resolveFlameLocalPosition(torchRoot, torchRoot);
    } else if (builtinTorchNode) {
      parent = builtinTorchNode;
      localPos = resolveFlameLocalPosition(builtinTorchNode, builtinTorchNode);
    } else {
      parent = handBone();
      if (!parent) return false;
      localPos = new THREE.Vector3(0.03, 0.14, 0.05);
    }

    if (!localPos) return false;

    flameAnchor.parent?.remove(flameAnchor);
    parent.add(flameAnchor);
    flameAnchor.position.copy(localPos);
    flameAnchor.rotation.set(0, 0, 0);
    flameAttached = true;
    const anchorKind = findTorchEmberObject(parent) ? "named-node" : "mesh-ember-centroid";
    console.log("[player3d] flame anchor", anchorKind, localPos.toArray().map((v) => +v.toFixed(4)));
    return true;
  }

  function updateFlameTipWorld() {
    // The ember/crystal node is parented into the rig, so its world position
    // tracks the animated (raised-torch) pose and sits right on the flame tip.
    // Bounding-box / bind-pose anchors drift off to the side on skinned models.
    if (emberAnchorNode) {
      emberAnchorNode.getWorldPosition(_tipPos);
      return;
    }

    if (flameAttached && flameAnchor) {
      flameAnchor.getWorldPosition(_tipPos);
      if (!useGlbFlame) {
        const def = FLAME_SHEET_BASE;
        _tipPos.y += def.planeH * (def.scale ?? 1) * 0.3;
      }
      return;
    }

    if (useGlbFlame && builtinFlameMesh) {
      _glowBox.setFromObject(builtinFlameMesh);
      _tipPos.set(
        (_glowBox.min.x + _glowBox.max.x) * 0.5,
        _glowBox.max.y - (_glowBox.max.y - _glowBox.min.y) * 0.2,
        (_glowBox.min.z + _glowBox.max.z) * 0.5
      );
      return;
    }

    if (torchFlameSphere) {
      torchFlameSphere.getWorldPosition(_tipPos);
    } else {
      const glow = findNamed("TRI_GLOW");
      const torch = findNamed("tripo_node") || findNamed("tripo_mesh");
      if (glow) {
        glow.getWorldPosition(_tipPos);
      } else if (torch) {
        _glowBox.setFromObject(torch);
        _tipPos.set(
          (_glowBox.min.x + _glowBox.max.x) * 0.5,
          _glowBox.max.y,
          (_glowBox.min.z + _glowBox.max.z) * 0.5
        );
      } else {
        const hand = handBone();
        if (hand) {
          _tipPos.set(hand.x, hand.y + 0.2, hand.z);
        }
      }
    }
  }

  function getFlamePlaneGeo(w, h) {
    const key = `${w}x${h}`;
    if (!flamePlaneGeoCache[key]) {
      const geo = new THREE.PlaneGeometry(w, h, 1, 6);
      geo.translate(0, h / 2, 0);
      flamePlaneGeoCache[key] = geo;
    }
    return flamePlaneGeoCache[key];
  }

  function createFlameSprite() {
    const neutralDef = FLAME_SHEET_BASE;
    const planeGeo = getFlamePlaneGeo(neutralDef.planeW, neutralDef.planeH);
    flameSpriteMat = createFlameSpriteMaterial(0);

    flameSprite = new THREE.Mesh(planeGeo, flameSpriteMat);
    flameSprite.renderOrder = 30;
    flameSprite.frustumCulled = false;
    flameAnchor.add(flameSprite);

    flameBloomSpriteMat = createFlameSpriteMaterial(1);
    flameBloomSprite = new THREE.Mesh(planeGeo, flameBloomSpriteMat);
    flameBloomSprite.renderOrder = 27;
    flameBloomSprite.frustumCulled = false;
    flameAnchor.add(flameBloomSprite);
  }

  function flameSpriteScreenAnchor(out) {
    const w = Math.max(1, canvas.clientWidth || canvas.width || 960);
    const h = Math.max(1, canvas.clientHeight || canvas.height || 540);
    bloomScreenAnchor(out);
    out.x += FLAME_SPRITE_NUDGE_PX.x / w;
    out.y += FLAME_SPRITE_NUDGE_PX.y / h;
    return out;
  }

  function ensureFlameSpritesOnScene() {
    if (!flameSprite || flameSprite.parent === scene) return;
    flameAnchor.remove(flameSprite);
    scene.add(flameSprite);
    if (flameBloomSprite) {
      flameAnchor.remove(flameBloomSprite);
      scene.add(flameBloomSprite);
    }
  }

  function nudgeFlameTowardTorchZ(outPos) {
    if (!FLAME_SPRITE_Z_NUDGE_PX) return outPos;
    const dist = camera.position.distanceTo(_tipPos);
    const h = Math.max(1, canvas.clientHeight || canvas.height || 540);
    const worldPerPx =
      (2 * Math.tan((camera.fov * Math.PI) / 360) * dist) / h;
    const step = worldPerPx * FLAME_SPRITE_Z_NUDGE_PX;
    const dz = _tipPos.z - outPos.z;
    if (Math.abs(dz) > 1e-6) {
      outPos.z += Math.sign(dz) * Math.min(Math.abs(dz), step);
    }
    return outPos;
  }

  function placeFlameSpritesAtScreenAnchor() {
    if (!flameSprite || !FLAME_SPRITE_LOCK_TO_BLOOM) return;
    ensureFlameSpritesOnScene();
    flameSpriteScreenAnchor(_bloomScreen);
    screenAnchorToWorld(_bloomScreen, _tipPos, _bloomPos);
    nudgeFlameTowardTorchZ(_bloomPos);
    flameSprite.position.copy(_bloomPos);
    if (flameBloomSprite) flameBloomSprite.position.copy(_bloomPos);
  }

  function syncFlameSprite(light, isCue = false) {
    if (!flameSprite) return;

    if (useGlbFlame || useBuiltinConeFlame) {
      flameSprite.visible = false;
      if (flameBloomSprite) flameBloomSprite.visible = false;
      return;
    }

    placeFlameSpritesAtScreenAnchor();

    flameSprite.lookAt(camera.position);

    const def = FLAME_SHEET_BASE;
    const pulse = 0.94 + 0.06 * Math.sin(flameAnimTime * 0.55);
    const sizeMul = (def.scale ?? 1.18) * (0.96 + 0.05 * light) * pulse * FLAME_DIAMOND_SCALE;
    const h = def.planeH * sizeMul;
    const w = def.planeW * sizeMul;
    flameSprite.scale.set(w / def.planeW, h / def.planeH, 1);
    flameSprite.visible = light > 0.02;

    if (flameBloomSprite) {
      flameBloomSprite.lookAt(camera.position);
      const haloMul = isCue ? 1.14 : 1.06;
      flameBloomSprite.scale.set(
        (w / def.planeW) * haloMul,
        (h / def.planeH) * haloMul,
        1
      );
      flameBloomSprite.visible = light > 0.02;
    }
  }

  function updateGlbFlameAnim(light, isCue, isBlue, isRed, moving = false) {
    if (!useGlbFlame || !builtinFlameMesh) return;

    builtinFlameMesh.visible = light > 0.02;
    if (!builtinFlameMesh.visible) return;

    const pulse = moving
      ? 0.93 + 0.07 * Math.sin(flameAnimTime * 5.8)
      : 0.985 + 0.015 * Math.sin(flameAnimTime * 2.4);
    const swayPulse = moving
      ? 1 + 0.04 * Math.sin(flameAnimTime * 3.2)
      : 1 + 0.012 * Math.sin(flameAnimTime * 2.0);
    if (builtinFlameMesh.userData.baseScale) {
      builtinFlameMesh.scale
        .copy(builtinFlameMesh.userData.baseScale)
        .multiplyScalar(pulse * swayPulse);
    }

    if (!glbFlameMat?.uniforms) {
      // This model's flame mesh has no flame texture/shader, so tint the
      // standard material directly to carry blue/red direction cues.
      tintFlameMeshMaterial(builtinFlameMesh, isBlue, isRed, light);
      return;
    }

    const mode = isBlue ? 1 : isRed ? 2 : 0;
    glbFlameMat.uniforms.time.value = flameAnimTime;
    glbFlameMat.uniforms.flameMode.value = mode;
    glbFlameMat.uniforms.light.value = light;
    glbFlameMat.uniforms.opacity.value = THREE.MathUtils.clamp(
      (isCue ? 1.18 : 1.12) * (0.82 + 0.28 * light) * pulse,
      0.55,
      1.45
    );
  }

  /** Cue tints for a plain (untextured) flame mesh. */
  const FLAME_CUE_BLUE = { color: [0.28, 0.55, 1.0], emissive: [0.2, 0.5, 1.0], emissiveIntensity: 2.6 };
  const FLAME_CUE_RED = { color: [1.0, 0.36, 0.16], emissive: [1.0, 0.28, 0.1], emissiveIntensity: 2.0 };

  function tintFlameMeshMaterial(mesh, isBlue, isRed, light) {
    if (!mesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m || !m.emissive) continue;
      if (!m.userData.__baseColor && m.color) m.userData.__baseColor = m.color.clone();
      if (!m.userData.__baseEmissive) m.userData.__baseEmissive = m.emissive.clone();
      if (m.userData.__baseEmissiveIntensity == null) {
        m.userData.__baseEmissiveIntensity = m.emissiveIntensity;
      }
      const cue = isBlue ? FLAME_CUE_BLUE : isRed ? FLAME_CUE_RED : null;
      if (cue) {
        m.emissive.setRGB(cue.emissive[0], cue.emissive[1], cue.emissive[2]);
        m.emissiveIntensity = cue.emissiveIntensity * (0.7 + 0.3 * light);
        if (m.color) m.color.setRGB(cue.color[0], cue.color[1], cue.color[2]);
        m.toneMapped = false;
      } else {
        m.emissive.copy(m.userData.__baseEmissive);
        m.emissiveIntensity = m.userData.__baseEmissiveIntensity;
        if (m.color && m.userData.__baseColor) m.color.copy(m.userData.__baseColor);
      }
    }
  }

  function updateFlameSpriteAnim(dt, light, isCue, isBlue = false, isRed = false, flame = null, moving = false) {
    if (!flameSprite) return;

    flameAnimTime += dt * (8.5 + 2.5 * light);
    syncFlameSprite(light, isCue);

    if (useGlbFlame) {
      updateGlbFlameAnim(light, isCue, isBlue, isRed, moving);
      return;
    }

    if (useBuiltinConeFlame) {
      const pulse = 0.9 + 0.1 * Math.sin(flameAnimTime * 4.2);
      if (bloomFeedMat && light > 0.02) {
        bloomFeedMat.opacity =
          0.82 * NEUTRAL_BLOOM_GAIN * (0.75 + 0.25 * light) * pulse;
      }
      return;
    }

    const mode = isBlue ? 1 : isRed ? 2 : 0;
    const coreOpacity = FLAME_DIAMOND_OPACITY;
    const haloOpacity = FLAME_DIAMOND_OPACITY * 0.85;

    setFlameMode(flameSpriteMat, mode, coreOpacity, flameAnimTime);
    if (flameBloomSpriteMat) {
      setFlameMode(flameBloomSpriteMat, mode, haloOpacity, flameAnimTime);
    }
  }

  function screenAnchorToWorld(anchor, depthRef, out) {
    const dist = camera.position.distanceTo(depthRef);
    _unproj.set(anchor.x * 2 - 1, -(anchor.y * 2 - 1), 0.5);
    _unproj.unproject(camera);
    _camDir.copy(_unproj).sub(camera.position).normalize();
    out.copy(camera.position).addScaledVector(_camDir, dist);
  }

  function placePointLightsAtScreen() {
    flameLight.position.copy(_tipPos);
    signalLight.position.copy(_tipPos);
    torchHeadLight.position.copy(_tipPos);
  }

  function updateSpriteScreen() {
    _proj.copy(_tipPos).project(camera);
    spriteScreenX = THREE.MathUtils.clamp(
      _proj.x * 0.5 + 0.5 + FLAME_SCREEN_BIAS.x,
      0.05,
      0.95
    );
    spriteScreenY = THREE.MathUtils.clamp(
      -_proj.y * 0.5 + 0.5 + FLAME_SCREEN_BIAS.y,
      0.05,
      0.95
    );
  }

  function frameRaisedArm() {
    if (!model) return;
    model.updateMatrixWorld(true);
    root.updateMatrixWorld(true);

    const head =
      boneWorld("Head") ||
      boneWorld("mixamorig:Head");

    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const headPos =
      head ||
      new THREE.Vector3(center.x, box.min.y + size.y * 0.88, center.z);

    const frameHeadY = headPos.y - pose.y;
    const camHeight = 0.55 * 1.05 * 1.1 * 1.2;
    const behind = Math.max(0.72, size.z * 0.76 + 0.48);

    const look = new THREE.Vector3(
      headPos.x,
      frameHeadY + 0.16 + AVATAR_VIEW_Y_LIFT,
      headPos.z
    );
    const cam = new THREE.Vector3(
      headPos.x,
      frameHeadY + camHeight + AVATAR_VIEW_Y_LIFT,
      headPos.z + behind
    );

    camera.fov = 46;
    camera.position.copy(cam);
    camera.lookAt(look.x, look.y, look.z);
    camera.near = 0.05;
    camera.far = 20;
    camera.updateProjectionMatrix();

    // Flame anchor follows torch; lights track flame center
    updateFlameTipWorld();

    placePointLightsAtScreen();
    updateSpriteScreen();
    flameScreenX = spriteScreenX;
    flameScreenY = spriteScreenY;

    syncFlameSprite(1, false);
  }

  const _bloomColor = new THREE.Color();

  function bloomScreenAnchor(out) {
    const w = Math.max(1, canvas.clientWidth || canvas.width || 960);
    const h = Math.max(1, canvas.clientHeight || canvas.height || 540);
    out.x = bloomScreen.x + bloomScreenNudgePx.x / w;
    out.y = bloomScreen.y + bloomScreenNudgePx.y / h;
    return out;
  }

  function placeBloomAtCrystal() {
    // Anchor bloom to the crystal tip in 3D (where the flame/ember sits).
    // The star markup was drawn on the crystal tip, so this puts bloom exactly there.
    if (ready) {
      updateFlameTipWorld();
      _bloomPos.copy(_tipPos);
      return;
    }
    bloomScreenAnchor(_bloomScreen);
    screenAnchorToWorld(_bloomScreen, _tipPos, _bloomPos);
  }

  function updateTorchHeadGlow(light, isCue = false, cueBoost = 1) {
    if (!torchHeadBloomGroup) return;

    // Follow the crystal tip in 3D so the glow sits on the torch, not a screen anchor.
    if (ready) updateFlameTipWorld();
    _torchHeadPos.copy(_tipPos);
    torchHeadBloomGroup.position.copy(_torchHeadPos);

    const active = light > 0.02;
    torchHeadBloomGroup.visible = active;
    if (!active) return;

    const lightMul = 0.75 + 0.25 * light;
    const flameMat = torchHeadFlame?.material;
    if (flameMat) {
      if (isCue) {
        flameMat.emissive.copy(flameTint);
        flameMat.emissiveIntensity = TORCH_HEAD_LANTERN.flameEmissive * cueBoost;
      } else {
        flameMat.emissive.setHex(0xffaa33);
        flameMat.emissiveIntensity = TORCH_HEAD_LANTERN.flameEmissive * lightMul;
      }
      flameMat.needsUpdate = true;
    }

    for (const { mesh, def } of torchHeadBloomOrbs) {
      if (isCue) {
        mesh.material.color.copy(flameTint);
        mesh.material.opacity = def.opacity * cueBoost * lightMul;
      } else {
        mesh.material.color.setHex(0xffd060);
        mesh.material.opacity = def.opacity * lightMul;
      }
    }
  }

  function applyBloomLayers(signalBoost = 1, cueBoost = 1, isCue = false, light = 1) {
    if (!USE_3D_BLOOM || !bloomFeedPlane) return;

    placeBloomAtCrystal();
    bloomFeedPlane.position.copy(_bloomPos);
    bloomFeedPlane.lookAt(camera.position);
    bloomFeedPlane.visible = false;

    if (!bloomFeedMat) return;

    if (isCue) {
      _bloomColor.copy(flameTint).multiplyScalar(1.35 * cueBoost * signalBoost);
      bloomFeedMat.color.copy(_bloomColor);
      bloomFeedMat.opacity = 0.92 * BLOOM_GAIN;
      updateTorchHeadGlow(light, true, cueBoost * signalBoost);
      return;
    }

    bloomFeedMat.color.setRGB(1.0, 0.52, 0.14);
    bloomFeedMat.opacity =
      light > 0.02 ? 0.78 * NEUTRAL_BLOOM_GAIN * (0.75 + 0.25 * light) : 0;

    updateTorchHeadGlow(light, false, 1);
  }

  createFlameSprite();

  const loader = new GLTFLoader();

  function finishAvatarSetup(gltf) {
    model = gltf.scene;
    const armature = model.getObjectByName("Armature") || model;

    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.frustumCulled = false;
        obj.castShadow = false;
        obj.receiveShadow = false;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          m.side = THREE.DoubleSide;
          m.depthWrite = true;
          m.clippingPlanes = null;
          if (
            /glow/i.test(m.name || "") ||
            /tri_glow/i.test(obj.name || "") ||
            /tri_glow/i.test(m.name || "")
          ) {
            obj.visible = false;
            m.transparent = true;
            m.depthWrite = false;
            m.toneMapped = false;
            if (!m.emissive) m.emissive = new THREE.Color(0xffa028);
            glowMaterials.push(m);
          }
          m.needsUpdate = true;
        }
      }
    });

    const box0 = new THREE.Box3().setFromObject(armature);
    const size0 = new THREE.Vector3();
    box0.getSize(size0);
    const s = size0.y > 0.001 ? 1.2 / size0.y : 1;
    model.scale.setScalar(s);

    const box1 = new THREE.Box3().setFromObject(armature);
    const center = new THREE.Vector3();
    box1.getCenter(center);
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box1.min.y;

    root.add(model);
    root.rotation.y = pose.yaw;
    root.scale.setScalar(pose.scale);

    root.updateMatrixWorld(true);
    const boxH = new THREE.Box3().setFromObject(armature);
    const sizeH = new THREE.Vector3();
    boxH.getSize(sizeH);
    avatarLowerY = sizeH.y * AVATAR_BURY_RATIO;
    pose.y = -avatarLowerY + AVATAR_VIEW_Y_LIFT * 0.52;
    root.position.set(pose.x, pose.y, pose.z);

    detectTorchSide();
    sanitizeExtraSceneRoots();
    builtinTorchNode = findBuiltinTorch();
    prepareBuiltinTorchMaterials();
    hideBuiltinTorchFlameMeshes();
    alignAvatarForward();

    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(model);
      const clip =
        gltf.animations.find((a) => /animation|idle|mixamo|layer/i.test(a.name)) ||
        gltf.animations[0];
      avatarAction = mixer.clipAction(clip);
      avatarAction.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      avatarAction.timeScale = AVATAR_ANIM_TIME_SCALE;
      // Hold a still pose until the player moves — the clip sways too much at idle.
      avatarAction.paused = true;
      avatarAction.time = 0;
      mixer.update(0);
    }
  }

  /** Rotate root so torso faces into the scene (-Z). */
  function alignAvatarForward() {
    if (!model) return;
    root.rotation.y = 0;
    model.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    // This rig exports facing +X; scene forward is -Z.
    pose.yaw = Math.PI / 2;
    root.rotation.y = pose.yaw;
  }

  function finishTorchSetup(torchGltf) {
    torchRoot = torchGltf.scene;
    setupTorchMeshes(torchRoot);
    const attached = attachExternalTorch();
    if (!attached) {
      console.warn("[player3d] external torch attach failed — using built-in torch");
      torchRoot = null;
      torchFlameSphere = null;
    }
    attachFlameToTorch();
  }

  function markReady() {
    attachFlameToTorch();
    frameRaisedArm();
    ready = true;
    applyBloomLayers(1, 0.28, false, 1);
    if (finalComposer) render();
    else renderer.render(scene, camera);
    console.log("[player3d] banker avatar ready", {
      model: MODEL_URL,
      torchSide,
      externalTorch: !!torchRoot,
      builtinTorch: !!builtinTorchNode,
      glbFlame: useGlbFlame,
      coneFlame: useBuiltinConeFlame,
      emberAnchor: emberAnchorNode?.name || null,
      glowMaterials: glowMaterials.length,
      avatarLowerY,
    });
  }

  let avatarGltf = null;

  loader.load(
    MODEL_URL,
    (gltf) => {
      avatarGltf = gltf;
      finishAvatarSetup(gltf);
      if (builtinTorchNode) {
        console.log("[player3d] using built-in torch mesh", builtinTorchNode.name);
        if (useGlbFlame) {
          console.log("[player3d] using built-in GLB flame mesh", builtinFlameMesh?.name);
        }
        markReady();
        return;
      }
      if (!USE_EXTERNAL_TORCH) {
        markReady();
        return;
      }
      loader.load(
        TORCH_URL,
        (torch) => {
          finishTorchSetup(torch);
          markReady();
        },
        undefined,
        (err) => {
          console.warn("[player3d] external torch load failed — using built-in torch", err);
          markReady();
        }
      );
    },
    undefined,
    (err) => {
      loadError = err;
      console.error("Failed to load banker avatar GLB:", err);
    }
  );

  function resize(cssWidth, cssHeight) {
    const w = Math.max(1, Math.floor(cssWidth));
    const h = Math.max(1, Math.floor(cssHeight));
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      if (bloomComposer) bloomComposer.setSize(w, h);
      if (finalComposer) finalComposer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function setBloomScreen(anchor = {}) {
    if (anchor.x != null) bloomScreen.x = anchor.x;
    if (anchor.y != null) bloomScreen.y = anchor.y;
    applyBloomLayers(1, 0.28, false, 1);
  }

  function setBloomNudge(px = {}) {
    if (px.x != null) bloomScreenNudgePx.x = px.x;
    if (px.y != null) bloomScreenNudgePx.y = px.y;
    applyBloomLayers(1, 0.28, false, 1);
  }

  function getBloomScreen() {
    return bloomScreenAnchor({ x: 0, y: 0 });
  }

  function getBloomNudge() {
    return { ...bloomScreenNudgePx };
  }

  function getBloomTuning() {
    return {
      locked: true,
      gridCell: BLOOM_TORCH_LOCK.gridCell,
      screen: getBloomScreen(),
      nudgePx: getBloomNudge(),
      note: "notes/BLOOM_TUNING.md",
    };
  }

  function setBloom(opts = {}) {
    if (opts.strength != null) bloom.strength = opts.strength;
    if (opts.radius != null) bloom.radius = opts.radius;
    if (opts.threshold != null) bloom.threshold = opts.threshold;
    if (opts.multiplier != null) bloomStrengthMul = opts.multiplier;
    syncBloomPass();
    applyBloomLayers();
  }

  function getBloom() {
    return {
      strength: bloom.strength,
      radius: bloom.radius,
      threshold: bloom.threshold,
      multiplier: bloomStrengthMul,
      effectiveStrength: bloom.strength * bloomStrengthMul,
    };
  }

  function setVisible(visible) {
    canvas.style.display = visible ? "block" : "none";
    canvas.style.visibility = visible ? "visible" : "hidden";
  }

  function updateAvatarAnimation(dt, moving) {
    if (!mixer || !avatarAction) return;

    if (moving) {
      if (avatarAction.paused) {
        avatarAction.paused = false;
        avatarAction.timeScale = AVATAR_ANIM_TIME_SCALE;
      }
      mixer.update(dt);
      return;
    }

    if (!avatarAction.paused) {
      avatarAction.paused = true;
      avatarAction.time = 0;
      avatarAction.timeScale = 0;
      mixer.update(0);
    }
  }

  function update(opts = {}) {
    const dt = clock.getDelta();
    const moving = !!opts.moving;
    updateAvatarAnimation(dt, moving);
    const bobPhase = opts.bobPhase || 0;
    const light = opts.light == null ? 1 : opts.light;
    const flame = opts.flame || { r: 255, g: 160, b: 40 };
    const cue = opts.flameCue || "neutral";
    const flamePower = opts.flamePower == null ? 0 : opts.flamePower;
    const isBlue = cue === "blue";
    const isRed = cue === "red";
    const isCue = isBlue || isRed;
    if (opts.bloom != null) bloomStrengthMul = opts.bloom;
    else bloomStrengthMul = 0.88 + 0.12 * light;

    // Steady fill on the avatar — torch color carries cues, not scene brightness
    hemi.intensity = 0.06;
    ambient.intensity = 0.04;
    key.intensity = 0.14;
    rim.intensity = 0.03;
    warmLight.intensity = 0.62;
    torchHeadLight.intensity =
      light > 0.02 ? TORCH_HEAD_LANTERN.glowIntensity * (0.75 + 0.25 * light) : 0;

    const bobMul = mixer ? ANIMATED_AVATAR_BOB_MUL : 1;
    idlePhase += dt;

    if (moving) {
      const bobX = Math.sin(bobPhase * 0.9) * 0.028 * bobMul;
      const bobY = Math.abs(Math.sin(bobPhase)) * 0.022 * bobMul;
      const bobZ = Math.cos(bobPhase * 0.9) * 0.012 * bobMul;
      root.position.x = pose.x + bobX;
      root.position.y = pose.y + bobY;
      root.position.z = pose.z + bobZ;
      root.rotation.y = pose.yaw + Math.sin(bobPhase * 0.45) * 0.032 * bobMul;
      root.rotation.z = Math.sin(bobPhase * 0.9) * 0.038 * bobMul;
      root.rotation.x = Math.abs(Math.sin(bobPhase)) * 0.022 * bobMul;
    } else {
      // Subtle procedural idle — gentle breathing + slow sway so the avatar
      // reads as "alive" while standing. Purely positional/rotational on the
      // root, so it's independent of the skeletal rig, bloom, and torch setup.
      const breatheY = Math.sin(idlePhase * IDLE_BREATHE_SPEED) * IDLE_BREATHE_AMP;
      const swayZ = Math.sin(idlePhase * IDLE_SWAY_SPEED) * IDLE_SWAY_AMP;
      const driftYaw = Math.sin(idlePhase * IDLE_YAW_SPEED) * IDLE_YAW_AMP;
      root.position.x = pose.x;
      root.position.y = pose.y + breatheY;
      root.position.z = pose.z;
      root.rotation.y = pose.yaw + driftYaw;
      root.rotation.z = swayZ;
      root.rotation.x = 0;
    }

    flameTint.setRGB(flame.r / 255, flame.g / 255, flame.b / 255);
    if (ready) {
      frameRaisedArm();
      if (torchRoot) torchRoot.updateMatrixWorld(true);
      if (builtinTorchNode) builtinTorchNode.updateMatrixWorld(true);
    }
    updateFlameSpriteAnim(dt, light, isCue, isBlue, isRed, flame, moving);

    if (ready) {
      updateFlameTipWorld();
      placePointLightsAtScreen();
      updateSpriteScreen();
      flameScreenX = spriteScreenX;
      flameScreenY = spriteScreenY;
    }

    const blueBoost = isBlue
      ? 1 + Math.min(0.95, (flame.b - flame.r) / 140)
      : 1;
    const redBoost = isRed
      ? 1 + Math.min(0.85, (flame.r - flame.b) / 140)
      : 1;
    const signalBoost = (isBlue ? blueBoost : isRed ? redBoost : 1) *
      (0.82 + 0.18 * flamePower);

    if (isCue) {
      const cueLightGain = isBlue ? BLUE_CUE_LIGHT_GAIN : 1;
      flameTint.setRGB(flame.r / 255, flame.g / 255, flame.b / 255);
      flameLight.color.copy(flameTint);
      flameLight.intensity = (1.9 + 0.6 * light) * signalBoost * cueLightGain;
      flameLight.distance = 3.4;

      signalLight.color.copy(flameTint);
      signalLight.intensity = (3.5 + 2.5 * light) * signalBoost * cueLightGain;
      signalLight.distance = 5;
      signalLight.visible = true;

      for (const m of glowMaterials) {
        m.visible = false;
      }
      applyBloomLayers(signalBoost, 0.85 * (0.55 + 0.45 * flamePower), true, light);
    } else {
      signalLight.visible = false;
      signalLight.intensity = 0;
      flameLight.color.copy(warmTint);
      flameLight.intensity = 2.0 + 0.65 * light;
      flameLight.distance = 3.4;

      for (const m of glowMaterials) {
        m.visible = false;
      }
      applyBloomLayers(1, 0.28, false, light);
    }

    syncBloomPass();
  }

  function render() {
    if (!ready) return;
    renderer.setClearColor(0x000000, 0);
    if (bloomComposer && finalComposer && bloomMixPass) {
      if (bloomFeedPlane) {
        bloomFeedPlane.visible = true;
        if (!bloomFeedPlane.parent) scene.add(bloomFeedPlane);
      }
      if (torchHeadBloomGroup?.visible) {
        if (!torchHeadBloomGroup.parent) scene.add(torchHeadBloomGroup);
      }
      camera.layers.enable(BLOOM_LAYER);
      scene.traverse(darkenNonBloomed);
      bloomComposer.render();
      scene.traverse(restoreNonBloomed);
      if (bloomFeedPlane?.parent) scene.remove(bloomFeedPlane);
      if (torchHeadBloomGroup?.parent) scene.remove(torchHeadBloomGroup);

      camera.layers.disable(BLOOM_LAYER);
      bloomMixPass.uniforms.bloomTexture.value = bloomComposer.readBuffer.texture;
      finalComposer.render();
      camera.layers.enable(BLOOM_LAYER);
      return;
    }
    renderer.render(scene, camera);
  }

  function dispose() {
    if (mixer) mixer.stopAllAction();
    if (flameSprite) {
      flameSprite.geometry.dispose();
      if (flameBloomSprite) flameBloomSprite.geometry.dispose();
      flameSpriteMat?.dispose();
      if (flameBloomSpriteMat) flameBloomSpriteMat.dispose();
    }
    glbFlameMat?.dispose();
    glbFlameMat = null;
    if (bloomFeedPlane) {
      bloomFeedPlane.geometry.dispose();
      bloomFeedMat?.dispose();
    }
    if (torchHeadBloomGroup) {
      torchHeadFlame?.geometry?.dispose();
      torchHeadFlame?.material?.dispose();
      for (const { mesh } of torchHeadBloomOrbs) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    for (const layer of bloomLayers) {
      layer.geometry.dispose();
      layer.material.dispose();
    }
    for (const layer of cueBloomLayers) {
      layer.geometry.dispose();
      layer.material.dispose();
    }
    if (bloomComposer) {
      for (const pass of bloomComposer.passes) pass.dispose?.();
    }
    if (finalComposer) {
      for (const pass of finalComposer.passes) pass.dispose?.();
    }
    bloomDarkMaterial.dispose();
    renderer.dispose();
  }

  return {
    get ready() {
      return ready;
    },
    get error() {
      return loadError;
    },
    getPointLightScreen() {
      return { x: flameScreenX, y: flameScreenY };
    },
    getFlameSpriteScreen() {
      return { x: spriteScreenX, y: spriteScreenY };
    },
    getFlameScreen() {
      return { x: flameScreenX, y: flameScreenY };
    },
    get neutralBloomEnabled() {
      return true;
    },
    get bloomEnabled() {
      return USE_3D_BLOOM;
    },
    setBloom,
    getBloom,
    setBloomScreen,
    getBloomScreen,
    setBloomNudge,
    getBloomNudge,
    getBloomTuning,
    resize,
    setVisible,
    update,
    render,
    dispose,
  };
}
