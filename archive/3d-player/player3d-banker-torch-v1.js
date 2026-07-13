/* ============================================
   First-person 3D player overlay (Three.js)
   Banker avatar with built-in torch + flame glow
   ============================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = "assets/player/banker1.0_withAnimation_andTorch.glb";
const TORCH_URL = "torch_flame_animation_2.0.glb";
const FLAME_SHEET_BASE = {
  planeW: 0.34,
  planeH: 0.56,
  cropVH: 0.46,
  cropInsetU: 0.14,
  scale: 1.32,
};

const FLAME_SHEETS = {
  neutral: {
    ...FLAME_SHEET_BASE,
    url: "assets/objects/torch-flame-orange-sheet.png",
    cols: 8,
    rows: 1,
    loopStart: 0,
    loopEnd: 7,
    fps: 12,
  },
  red: {
    ...FLAME_SHEET_BASE,
    url: "assets/objects/torch-flame-red-sheet.png",
    cols: 6,
    rows: 1,
    loopStart: 0,
    loopEnd: 5,
    fps: 12,
  },
  blue: {
    ...FLAME_SHEET_BASE,
    url: "assets/objects/torch-flame-blue-sheet.png",
    cols: 6,
    rows: 1,
    loopStart: 0,
    loopEnd: 5,
    fps: 12,
  },
};

/** Viewport-normalized anchors (playfield grid rows 3–8). */
const POINT_LIGHT_SCREEN = { x: 0.359, y: 0.25 }; // between F4 & G4
const BLOOM_SCREEN = { x: 0.328, y: 0.11 }; // F3 / G3 — off while tuning point light
/** Cue bloom (blue/red at F3/G3) — off until re-enabled. */
const BLOOM_ENABLED = false;
/** Soft warm orange bloom at the point light when neutral. */
const NEUTRAL_BLOOM_ENABLED = true;
const NEUTRAL_BLOOM_GAIN = 0.52;

/** Global bloom intensity scaler (tune down/up without touching every layer). */
const BLOOM_GAIN = 0.64;

/** Default bloom tuning for the torch flame (additive layers, not post-FX) */
const DEFAULT_BLOOM = {
  strength: 1.15,
  radius: 0.42,
  threshold: 0.22,
};

const CUE_BLOOM_LAYER_DEFS = [
  { scale: 0.32, opacity: 0.28 },
  { scale: 0.48, opacity: 0.14 },
  { scale: 0.68, opacity: 0.06 },
];

export function createPlayer3D(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, 960 / 540, 0.05, 20);
  camera.position.set(0.4, 1.2, 0.9);
  camera.lookAt(0.3, 1.1, 0);

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

  const flameLight = new THREE.PointLight(0xffa028, 3.0, 5, 1.2);
  flameLight.position.set(0.4, 1.25, 0.3);
  scene.add(flameLight);

  // Bright blue/red signal light — only at the torch flame on direction cues
  const signalLight = new THREE.PointLight(0x4488ff, 0, 7, 1.0);
  signalLight.position.set(0.4, 1.25, 0.3);
  scene.add(signalLight);

  // Additive bloom layers at the flame (keeps canvas transparent for the maze)
  const bloomLayers = [];
  const bloomLayerDefs = [
    { scale: 0.09, opacity: 0.95 },
    { scale: 0.16, opacity: 0.45 },
    { scale: 0.28, opacity: 0.18 },
  ];
  for (const layer of bloomLayerDefs) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffa028,
      transparent: true,
      opacity: layer.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), mat);
    mesh.renderOrder = 20;
    mesh.userData.bloomScale = layer.scale;
    mesh.userData.bloomBaseOpacity = layer.opacity;
    scene.add(mesh);
    bloomLayers.push(mesh);
  }

  const cueBloomLayers = [];
  for (const layer of CUE_BLOOM_LAYER_DEFS) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: layer.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 12), mat);
    mesh.renderOrder = 22;
    mesh.visible = false;
    mesh.userData.bloomScale = layer.scale;
    mesh.userData.bloomBaseOpacity = layer.opacity;
    scene.add(mesh);
    cueBloomLayers.push(mesh);
  }

  const bloom = { ...DEFAULT_BLOOM };
  let bloomStrengthMul = 1;

  const flameAnchor = new THREE.Group();
  const root = new THREE.Group();
  scene.add(root);
  root.add(flameAnchor);

  let model = null;
  let torchRoot = null;
  let torchFlameSphere = null;
  let mixer = null;
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
  let activeFlameSheet = "neutral";
  const flameTextures = {};
  let flameAttached = false;
  const flamePlaneGeoCache = {};
  const _tipPos = new THREE.Vector3();
  const _wickWorld = new THREE.Vector3();
  const _glowBox = new THREE.Box3();
  const _proj = new THREE.Vector3();
  const _unproj = new THREE.Vector3();
  const _camDir = new THREE.Vector3();
  const _bloomPos = new THREE.Vector3();
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
    yaw: Math.PI,
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

  function hideBuiltinTorch() {
    const builtin = findNamed("tripo_node_a4cf6338");
    if (builtin) builtin.visible = false;
    const glow = findNamed("TRI_GLOW");
    if (glow) glow.visible = false;
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
    const hand =
      findNamed(`mixamorig:${torchSide}Hand`) ||
      findNamed(`${torchSide}Hand`);
    const builtin = findNamed("tripo_node_a4cf6338");
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
    const rh = boneWorld("mixamorig:RightHand") || boneWorld("RightHand");
    const lh = boneWorld("mixamorig:LeftHand") || boneWorld("LeftHand");
    if (rh && lh) torchSide = rh.y >= lh.y ? "Right" : "Left";
  }

  function createFlameSpriteMaterial(texture) {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        tint: { value: new THREE.Color(1, 1, 1) },
        opacity: { value: 1 },
        keyThreshold: { value: 0.065 },
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
        uniform vec3 tint;
        uniform float opacity;
        uniform float keyThreshold;
        varying vec2 vUv;
        void main() {
          vec4 sampleColor = texture2D(map, vUv);
          float lum = max(sampleColor.r, max(sampleColor.g, sampleColor.b));
          if (lum < keyThreshold) discard;
          float topFade = 1.0 - smoothstep(0.68, 0.9, vUv.y);
          float alpha = lum * opacity * topFade;
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(sampleColor.rgb * tint, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
  }

  function setFlameMatTint(mat, tint, opacity) {
    if (!mat?.uniforms) return;
    mat.uniforms.tint.value.copy(tint);
    mat.uniforms.opacity.value = opacity;
  }

  function syncBloomSpriteTexture() {
    if (!flameBloomSpriteMat?.uniforms?.map || !flameSpriteMat?.uniforms?.map) return;
    const src = flameSpriteMat.uniforms.map.value;
    const dst = flameBloomSpriteMat.uniforms.map.value;
    if (dst !== src) flameBloomSpriteMat.uniforms.map.value = src;
    dst.offset.copy(src.offset);
    dst.repeat.copy(src.repeat);
  }

  function loadFlameTexture(key) {
    const def = FLAME_SHEETS[key];
    const tex = new THREE.TextureLoader().load(def.url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    flameTextures[key] = tex;
    return tex;
  }

  function getFlamePlaneGeo(w, h) {
    const key = `${w}x${h}`;
    if (!flamePlaneGeoCache[key]) {
      const geo = new THREE.PlaneGeometry(w, h);
      geo.translate(0, h / 2, 0);
      flamePlaneGeoCache[key] = geo;
    }
    return flamePlaneGeoCache[key];
  }

  function setFlameSpriteFrame(sheetKey, index) {
    const def = FLAME_SHEETS[sheetKey];
    const tex = flameTextures[sheetKey];
    if (!def || !tex) return;
    const frames = def.cols * def.rows;
    const frame = ((index % frames) + frames) % frames;
    const col = frame % def.cols;
    const row = Math.floor(frame / def.cols);
    const cropVH = def.cropVH ?? 1;
    const inset = def.cropInsetU ?? 0;
    const frameU = 1 / def.cols;
    tex.repeat.set(frameU * (1 - inset * 2), cropVH);
    tex.offset.set(
      col * frameU + frameU * inset,
      1 - (row + 1) / def.rows * cropVH
    );
  }

  function setActiveFlameSheet(sheetKey) {
    if (activeFlameSheet === sheetKey || !flameTextures[sheetKey]) return;
    activeFlameSheet = sheetKey;
    flameSpriteMat.uniforms.map.value = flameTextures[sheetKey];
    flameAnimTime = 0;
  }

  function attachFlameToTorch() {
    if (!flameAnchor || flameAttached || !model) return false;

    model.updateMatrixWorld(true);
    let parent = null;
    const localPos = new THREE.Vector3();

    if (torchRoot) {
      torchRoot.updateMatrixWorld(true);
      parent = torchRoot;

      if (torchFlameSphere) {
        torchFlameSphere.updateMatrixWorld(true);
        const sBox = new THREE.Box3().setFromObject(torchFlameSphere);
        _wickWorld.set(
          (sBox.min.x + sBox.max.x) * 0.5,
          sBox.min.y + (sBox.max.y - sBox.min.y) * 0.12,
          (sBox.min.z + sBox.max.z) * 0.5
        );
      } else {
        const tBox = new THREE.Box3().setFromObject(torchRoot);
        _wickWorld.set(
          (tBox.min.x + tBox.max.x) * 0.5,
          tBox.max.y - (tBox.max.y - tBox.min.y) * 0.1,
          (tBox.min.z + tBox.max.z) * 0.5
        );
      }
      localPos.copy(_wickWorld);
      torchRoot.worldToLocal(localPos);
    } else {
      parent =
        findNamed(`mixamorig:${torchSide}Hand`) ||
        findNamed(`${torchSide}Hand`);
      if (!parent) return false;
      localPos.set(0.03, 0.14, 0.05);
    }

    flameAnchor.parent?.remove(flameAnchor);
    parent.add(flameAnchor);
    flameAnchor.position.copy(localPos);
    flameAnchor.rotation.set(0, 0, 0);
    flameAttached = true;
    return true;
  }

  function updateFlameTipWorld() {
    if (flameAttached && flameAnchor) {
      flameAnchor.getWorldPosition(_tipPos);
      const def = FLAME_SHEETS[activeFlameSheet] || FLAME_SHEETS.neutral;
      _tipPos.y += def.planeH * (def.scale ?? 1) * 0.38;
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
        const hand =
          boneWorld(`mixamorig:${torchSide}Hand`) ||
          boneWorld(`${torchSide}Hand`);
        if (hand) {
          _tipPos.set(hand.x, hand.y + 0.2, hand.z);
        }
      }
    }
  }

  function createFlameSprite() {
    const neutralDef = FLAME_SHEETS.neutral;
    for (const key of Object.keys(FLAME_SHEETS)) {
      loadFlameTexture(key);
    }

    const planeGeo = getFlamePlaneGeo(neutralDef.planeW, neutralDef.planeH);
    flameSpriteMat = createFlameSpriteMaterial(flameTextures.neutral);

    flameSprite = new THREE.Mesh(planeGeo, flameSpriteMat);
    flameSprite.renderOrder = 30;
    flameSprite.frustumCulled = false;
    flameAnchor.add(flameSprite);

    flameBloomSpriteMat = createFlameSpriteMaterial(flameTextures.neutral);
    flameBloomSpriteMat.uniforms.opacity.value = 0.55;
    flameBloomSpriteMat.depthTest = false;
    flameBloomSprite = new THREE.Mesh(planeGeo, flameBloomSpriteMat);
    flameBloomSprite.renderOrder = 28;
    flameBloomSprite.visible = false;
    flameBloomSprite.frustumCulled = false;
    flameAnchor.add(flameBloomSprite);

    setFlameSpriteFrame("neutral", neutralDef.loopStart);
  }

  function syncFlameSprite(light, isCue = false) {
    if (!flameSprite) return;

    flameSprite.position.set(0, 0, 0);
    flameSprite.lookAt(camera.position);

    const def = FLAME_SHEETS[activeFlameSheet];
    const pulse = 0.94 + 0.06 * Math.sin(flameAnimTime * 0.55);
    const sizeMul = (def.scale ?? 1.28) * (0.97 + 0.06 * light) * pulse;
    const h = def.planeH * sizeMul;
    const w = def.planeW * sizeMul;
    flameSprite.scale.set(w / def.planeW, h / def.planeH, 1);
    flameSprite.visible = light > 0.02;

    if (flameBloomSprite) {
      flameBloomSprite.position.set(0, 0, 0);
      flameBloomSprite.lookAt(camera.position);
      const bloomMul = isCue ? 1.35 : 1.12;
      flameBloomSprite.scale.set(
        (w / def.planeW) * bloomMul,
        (h / def.planeH) * bloomMul,
        1
      );
      flameBloomSprite.visible = BLOOM_ENABLED && isCue && light > 0.02;
      syncBloomSpriteTexture();
    }
  }

  function updateFlameSpriteAnim(dt, light, isCue, isBlue = false, isRed = false) {
    if (!flameSprite) return;

    const sheetKey = isBlue ? "blue" : isRed ? "red" : "neutral";
    setActiveFlameSheet(sheetKey);
    const def = FLAME_SHEETS[sheetKey];
    const loopLen = def.loopEnd - def.loopStart + 1;
    flameAnimTime += dt * def.fps * (0.9 + 0.2 * light);
    const frame = def.loopStart + (Math.floor(flameAnimTime) % loopLen);
    setFlameSpriteFrame(sheetKey, frame);
    syncFlameSprite(light, isCue);

    if (isBlue) {
      spriteTint.setRGB(0.98, 1.02, 1.05);
    } else if (isRed) {
      spriteTint.setRGB(1.02, 0.98, 0.98);
    } else {
      spriteTint.setRGB(1, 1, 1);
    }
    const opacity = isCue || isBlue || isRed ? 1 : 0.92;
    setFlameMatTint(flameSpriteMat, spriteTint, opacity);
    if (flameBloomSpriteMat && (isCue || isBlue || isRed)) {
      setFlameMatTint(
        flameBloomSpriteMat,
        spriteTint,
        (0.38 + 0.15 * light) * BLOOM_GAIN
      );
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
    screenAnchorToWorld(POINT_LIGHT_SCREEN, _tipPos, flameLight.position);
    signalLight.position.copy(flameLight.position);
    flameScreenX = POINT_LIGHT_SCREEN.x;
    flameScreenY = POINT_LIGHT_SCREEN.y;
  }

  function updateSpriteScreen() {
    _proj.copy(_tipPos).project(camera);
    spriteScreenX = THREE.MathUtils.clamp(_proj.x * 0.5 + 0.5, 0.05, 0.95);
    spriteScreenY = THREE.MathUtils.clamp(-_proj.y * 0.5 + 0.5, 0.05, 0.95);
  }

  function frameRaisedArm() {
    if (!model) return;
    model.updateMatrixWorld(true);
    root.updateMatrixWorld(true);

    const head =
      boneWorld("mixamorig:Head") || boneWorld("Head");

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

    const look = new THREE.Vector3(headPos.x, frameHeadY + 0.16, headPos.z);
    const cam = new THREE.Vector3(
      headPos.x,
      frameHeadY + camHeight,
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

    if (BLOOM_ENABLED && isCue) {
      screenAnchorToWorld(BLOOM_SCREEN, _tipPos, _bloomPos);
      const bloomMul = bloom.strength * bloomStrengthMul;
      const bloomReach = 0.75 + bloom.radius * 1.6;
      for (const layer of bloomLayers) {
        layer.position.copy(_bloomPos);
        const s = layer.userData.bloomScale * bloomReach * bloomMul;
        layer.scale.setScalar(s);
      }
      for (const layer of cueBloomLayers) {
        layer.position.copy(_bloomPos);
      }
    } else if (NEUTRAL_BLOOM_ENABLED) {
      const bloomMul = bloom.strength * bloomStrengthMul * 0.65;
      const bloomReach = 0.55 + bloom.radius * 0.9;
      for (const layer of bloomLayers) {
        layer.position.copy(flameLight.position);
        layer.scale.setScalar(layer.userData.bloomScale * bloomReach * bloomMul);
      }
    }

    syncFlameSprite(1, false);
  }

  const _bloomColor = new THREE.Color();

  function applyBloomLayers(signalBoost = 1, cueBoost = 1, isCue = false, light = 1) {
    if (isCue && BLOOM_ENABLED) {
      screenAnchorToWorld(BLOOM_SCREEN, _tipPos, _bloomPos);
      const bloomMul = bloom.strength * bloomStrengthMul * 1.2;
      const reach = 0.75 + bloom.radius * 1.6;
      const opacityMul = bloomMul * (1.1 - bloom.threshold * 0.5);
      const signalOpacity = 1.35 * cueBoost * signalBoost;

      _bloomColor.copy(flameTint).multiplyScalar(1.6);

      for (const layer of bloomLayers) {
        layer.position.copy(_bloomPos);
        layer.visible = light > 0.02;
        layer.scale.setScalar(layer.userData.bloomScale * reach * bloomMul);
        layer.material.color.copy(_bloomColor);
        layer.material.opacity =
          layer.userData.bloomBaseOpacity * opacityMul * signalOpacity * BLOOM_GAIN;
      }

      for (const layer of cueBloomLayers) {
        layer.position.copy(_bloomPos);
        const cueReach = reach * 2.1;
        layer.visible = light > 0.02;
        layer.scale.setScalar(layer.userData.bloomScale * cueReach * bloomMul);
        layer.material.color.copy(_bloomColor);
        layer.material.opacity =
          layer.userData.bloomBaseOpacity * opacityMul * 1.35 * cueBoost * signalBoost * BLOOM_GAIN;
      }
      return;
    }

    for (const layer of cueBloomLayers) {
      layer.visible = false;
      layer.material.opacity = 0;
    }

    if (!isCue && NEUTRAL_BLOOM_ENABLED && light > 0.02) {
      const bloomMul = bloom.strength * bloomStrengthMul * 0.65;
      const reach = 0.55 + bloom.radius * 0.9;
      const warm = new THREE.Color(1.0, 0.52, 0.14);
      const neutralMul = NEUTRAL_BLOOM_GAIN * (0.72 + 0.28 * light);

      bloomLayers.forEach((layer, i) => {
        layer.position.copy(flameLight.position);
        layer.visible = true;
        const tier = i === 0 ? 1 : i === 1 ? 0.55 : 0.28;
        layer.scale.setScalar(layer.userData.bloomScale * reach * bloomMul * (1 + i * 0.35));
        layer.material.color.copy(warm);
        layer.material.opacity =
          layer.userData.bloomBaseOpacity * 0.11 * tier * neutralMul;
      });
      return;
    }

    for (const layer of bloomLayers) {
      layer.visible = false;
      layer.material.opacity = 0;
    }
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
    avatarLowerY = sizeH.y * 0.72;
    pose.y = -avatarLowerY;
    root.position.set(pose.x, pose.y, pose.z);

    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(model);
      const clip =
        gltf.animations.find((a) => /idle|mixamo|layer/i.test(a.name)) ||
        gltf.animations[0];
      const action = mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      action.timeScale = 1;
      mixer.update(0.05);
    }

    detectTorchSide();
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
    applyBloomLayers();
    renderer.render(scene, camera);
    console.log("[player3d] banker avatar ready", {
      torchSide,
      externalTorch: !!torchRoot,
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
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  function setBloom(opts = {}) {
    if (opts.strength != null) bloom.strength = opts.strength;
    if (opts.radius != null) bloom.radius = opts.radius;
    if (opts.threshold != null) bloom.threshold = opts.threshold;
    if (opts.multiplier != null) bloomStrengthMul = opts.multiplier;
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

  function update(opts = {}) {
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);

    const moving = !!opts.moving;
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

    const bobX = moving ? Math.sin(bobPhase * 0.9) * 0.028 : 0;
    const bobY = moving ? Math.abs(Math.sin(bobPhase)) * 0.022 : 0;
    const bobZ = moving ? Math.cos(bobPhase * 0.9) * 0.012 : 0;
    root.position.x = pose.x + bobX;
    root.position.y = pose.y + bobY;
    root.position.z = pose.z + bobZ;

    if (moving) {
      root.rotation.y = pose.yaw + Math.sin(bobPhase * 0.45) * 0.032;
      root.rotation.z = Math.sin(bobPhase * 0.9) * 0.038;
      root.rotation.x = Math.abs(Math.sin(bobPhase)) * 0.022;
    } else {
      root.rotation.y = pose.yaw;
      root.rotation.z = 0;
      root.rotation.x = 0;
    }

    flameTint.setRGB(flame.r / 255, flame.g / 255, flame.b / 255);
    if (ready) {
      frameRaisedArm();
      if (torchRoot) torchRoot.updateMatrixWorld(true);
    }
    updateFlameSpriteAnim(dt, light, isCue, isBlue, isRed);

    const blueBoost = isBlue
      ? 1 + Math.min(0.95, (flame.b - flame.r) / 140)
      : 1;
    const redBoost = isRed
      ? 1 + Math.min(0.85, (flame.r - flame.b) / 140)
      : 1;
    const signalBoost = (isBlue ? blueBoost : isRed ? redBoost : 1) *
      (0.82 + 0.18 * flamePower);

    if (isCue) {
      flameTint.setRGB(flame.r / 255, flame.g / 255, flame.b / 255);
      flameLight.color.copy(flameTint);
      flameLight.intensity = (0.85 + 0.35 * light) * signalBoost;
      flameLight.distance = 2.6;

      signalLight.color.copy(flameTint);
      signalLight.intensity = (3.5 + 2.5 * light) * signalBoost;
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
      flameLight.intensity = 0.52 + 0.18 * light;
      flameLight.distance = 2.2;

      for (const m of glowMaterials) {
        m.visible = false;
      }
      applyBloomLayers(1, 0.28, false, light);
    }
  }

  function render() {
    if (!ready) return;
    renderer.render(scene, camera);
  }

  function dispose() {
    if (mixer) mixer.stopAllAction();
    if (flameSprite) {
      flameSprite.geometry.dispose();
      if (flameBloomSprite) flameBloomSprite.geometry.dispose();
      flameSpriteMat?.dispose();
      for (const tex of Object.values(flameTextures)) {
        tex?.dispose();
      }
      if (flameBloomSpriteMat) flameBloomSpriteMat.dispose();
    }
    for (const layer of bloomLayers) {
      layer.geometry.dispose();
      layer.material.dispose();
    }
    for (const layer of cueBloomLayers) {
      layer.geometry.dispose();
      layer.material.dispose();
    }
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
    get bloomEnabled() {
      return BLOOM_ENABLED;
    },
    get neutralBloomEnabled() {
      return NEUTRAL_BLOOM_ENABLED;
    },
    setBloom,
    getBloom,
    resize,
    setVisible,
    update,
    render,
    dispose,
  };
}
