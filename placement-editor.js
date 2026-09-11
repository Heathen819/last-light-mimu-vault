/* ============================================
   Placement editor — TransformControls + panel
   Gizmos draw on a dedicated top canvas so bloom /
   player overlays cannot hide the RGB axes.
   ============================================ */

import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  loadPlacementOffsets,
  clearPlacementOffsets,
  writePlacementOffset,
  removePlacementOffset,
  offsetFromObject,
  setPlacementSkipApply,
  invalidatePlacementCache,
} from "./placement-offsets.js?v=2";

/**
 * @param {{
 *   worldApi: null | (() => object | null),
 *   playerApi: null | (() => object | null),
 *   isPlaying: () => boolean,
 *   onActiveChange?: (active: boolean) => void,
 * }} opts
 */
export function createPlacementEditor(opts) {
  const getWorld = opts.worldApi || (() => null);
  const getPlayer = opts.playerApi || (() => null);
  const isPlaying = opts.isPlaying || (() => true);
  const onActiveChange = opts.onActiveChange || (() => {});

  let active = false;
  let mode = "translate";
  let currentId = "";
  let currentSceneKey = ""; // "world" | "player"
  let controls = null;
  let statusTimer = 0;
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const _worldPos = new THREE.Vector3();
  const _worldQuat = new THREE.Quaternion();
  const _worldScale = new THREE.Vector3();
  const _localPos = new THREE.Vector3();
  const _localQuat = new THREE.Quaternion();
  const _localScale = new THREE.Vector3();
  const _mat = new THREE.Matrix4();
  const _parentInv = new THREE.Matrix4();
  const _proj = new THREE.Vector3();
  let pickCooldown = 0;
  let pendingPick = null;
  let lastTargetSig = "";
  let suppressTargetChange = false;

  /* Dedicated transparent canvas above the game + avatar layers */
  const gizmoCanvas = document.createElement("canvas");
  gizmoCanvas.id = "placement-gizmo-canvas";
  gizmoCanvas.className = "placement-gizmo-canvas";
  const viewportEl = document.getElementById("viewport") || document.body;
  viewportEl.appendChild(gizmoCanvas);

  const overlayRenderer = new THREE.WebGLRenderer({
    canvas: gizmoCanvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
  overlayRenderer.setClearColor(0x000000, 0);
  overlayRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const overlayScene = new THREE.Scene();
  const overlayCam = new THREE.PerspectiveCamera(50, 1, 0.05, 200);

  const attachProxy = new THREE.Object3D();
  attachProxy.name = "placementAttachProxy";
  overlayScene.add(attachProxy);

  let attachedObj = null;
  let proxyLiftY = 0;
  let syncingFromProxy = false;

  function gizmoLiftFor(id) {
    if (id === "player") return 1.2;
    if (id === "torch") return 0.25;
    if (String(id).startsWith("lantern")) return 0.55;
    if (String(id).startsWith("null")) return 0.75;
    if (id === "exit") return 1.1;
    return 0.5;
  }

  function styleHelper(helper) {
    if (!helper) return;
    helper.visible = true;
    helper.renderOrder = 999;
    helper.traverse((child) => {
      child.renderOrder = 999;
      if (!child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        m.depthTest = false;
        m.depthWrite = false;
        m.transparent = true;
        if ("fog" in m) m.fog = false;
        if ("toneMapped" in m) m.toneMapped = false;
      }
    });
  }

  function syncOverlayCamera(src) {
    if (!src) return;
    src.updateMatrixWorld(true);
    overlayCam.fov = src.fov;
    overlayCam.near = Math.min(0.05, src.near || 0.05);
    overlayCam.far = Math.max(200, src.far || 100);
    overlayCam.aspect = src.aspect > 0 ? src.aspect : 1;
    src.getWorldPosition(overlayCam.position);
    src.getWorldQuaternion(overlayCam.quaternion);
    overlayCam.updateProjectionMatrix();
  }

  function resizeGizmoCanvas() {
    const host = gizmoCanvas.parentElement || viewportEl;
    const w = Math.max(1, Math.floor(host.clientWidth || 1));
    const h = Math.max(1, Math.floor(host.clientHeight || 1));
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.floor(w * pr);
    const bh = Math.floor(h * pr);
    if (gizmoCanvas.width !== bw || gizmoCanvas.height !== bh) {
      overlayRenderer.setPixelRatio(pr);
      overlayRenderer.setSize(w, h, false);
      overlayCam.aspect = w / h;
      overlayCam.updateProjectionMatrix();
    }
  }

  function syncProxyFromObject(obj) {
    if (!obj || syncingFromProxy) return;
    obj.updateMatrixWorld(true);
    obj.getWorldPosition(_worldPos);
    obj.getWorldQuaternion(_worldQuat);
    obj.getWorldScale(_worldScale);
    attachProxy.position.copy(_worldPos);
    attachProxy.position.y += proxyLiftY;
    attachProxy.quaternion.copy(_worldQuat);
    attachProxy.scale.set(
      Math.max(1e-3, Math.abs(_worldScale.x)),
      Math.max(1e-3, Math.abs(_worldScale.y)),
      Math.max(1e-3, Math.abs(_worldScale.z))
    );
    attachProxy.updateMatrixWorld(true);
  }

  function syncObjectFromProxy(obj) {
    if (!obj?.parent || syncingFromProxy) return;
    syncingFromProxy = true;
    _worldPos.set(
      attachProxy.position.x,
      attachProxy.position.y - proxyLiftY,
      attachProxy.position.z
    );
    const sx = Math.abs(attachProxy.scale.x) < 1e-4 ? 1 : attachProxy.scale.x;
    const sy = Math.abs(attachProxy.scale.y) < 1e-4 ? 1 : attachProxy.scale.y;
    const sz = Math.abs(attachProxy.scale.z) < 1e-4 ? 1 : attachProxy.scale.z;
    _worldScale.set(sx, sy, sz);
    _mat.compose(_worldPos, attachProxy.quaternion, _worldScale);
    _parentInv.copy(obj.parent.matrixWorld).invert();
    _mat.premultiply(_parentInv);
    _mat.decompose(_localPos, _localQuat, _localScale);
    if (
      Math.abs(_localScale.x) < 1e-4 ||
      Math.abs(_localScale.y) < 1e-4 ||
      Math.abs(_localScale.z) < 1e-4
    ) {
      syncingFromProxy = false;
      return;
    }
    obj.position.copy(_localPos);
    obj.quaternion.copy(_localQuat);
    obj.scale.copy(_localScale);
    syncingFromProxy = false;
  }

  function isObjectOnScreen(obj, camera) {
    if (!obj || !camera) return false;
    obj.getWorldPosition(_proj);
    _proj.y += proxyLiftY * 0.5;
    _proj.project(camera);
    return (
      Math.abs(_proj.x) <= 1.15 &&
      Math.abs(_proj.y) <= 1.15 &&
      _proj.z >= -1 &&
      _proj.z <= 1
    );
  }

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.id = "placement-edit-toggle";
  toggleBtn.className = "placement-edit-toggle hidden";
  toggleBtn.setAttribute("aria-pressed", "false");
  toggleBtn.innerHTML = `
    <span class="placement-edit-toggle-label">Edit</span>
    <span class="placement-edit-toggle-state" data-state>OFF</span>
  `;
  document.body.appendChild(toggleBtn);
  const toggleStateEl = toggleBtn.querySelector("[data-state]");

  const panel = document.createElement("div");
  panel.id = "placement-editor";
  panel.className = "placement-editor hidden";
  panel.innerHTML = `
    <div class="placement-editor-header">
      <div class="placement-editor-title-row">
        <strong>Placement editor</strong>
        <button type="button" id="pe-power" class="placement-editor-power is-on" aria-pressed="true">
          <span class="placement-editor-power-dot" aria-hidden="true"></span>
          <span data-power-label>ON</span>
        </button>
      </div>
      <span class="placement-editor-hint">WASD move · RMB look · 1/2/3 gizmo · F2</span>
    </div>
    <label class="placement-editor-row">
      <span>Target</span>
      <select id="pe-target"></select>
    </label>
    <div class="placement-editor-modes">
      <button type="button" data-mode="translate" class="is-active">Move (1)</button>
      <button type="button" data-mode="rotate">Rotate (2)</button>
      <button type="button" data-mode="scale">Scale (3)</button>
    </div>
    <div class="placement-editor-actions">
      <button type="button" id="pe-reset">Reset selected</button>
      <button type="button" id="pe-reset-all">Reset all</button>
      <button type="button" id="pe-copy">Copy JSON</button>
    </div>
    <p id="pe-status" class="placement-editor-status" aria-live="polite"></p>
  `;
  document.body.appendChild(panel);

  const targetSel = panel.querySelector("#pe-target");
  const statusEl = panel.querySelector("#pe-status");
  const powerBtn = panel.querySelector("#pe-power");
  const modeBtns = panel.querySelectorAll(".placement-editor-modes button");

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
    statusTimer = 2.5;
  }

  function syncToggleUi() {
    toggleBtn.classList.toggle("is-on", active);
    toggleBtn.setAttribute("aria-pressed", active ? "true" : "false");
    if (toggleStateEl) toggleStateEl.textContent = active ? "ON" : "OFF";
    if (powerBtn) {
      powerBtn.classList.toggle("is-on", active);
      powerBtn.setAttribute("aria-pressed", active ? "true" : "false");
      const powerLabel = powerBtn.querySelector("[data-power-label]");
      if (powerLabel) powerLabel.textContent = active ? "ON" : "OFF";
    }
    gizmoCanvas.classList.toggle("is-active", active);
    const worldDom = getWorld()?.domElement;
    if (worldDom) {
      worldDom.classList.toggle("placement-edit-cursor", active);
    }
  }

  function sharedPointerDom() {
    return getWorld()?.domElement || getPlayer()?.domElement || null;
  }

  function ensureControls() {
    const pointerDom = sharedPointerDom();
    if (!pointerDom) return null;
    if (!controls) {
      controls = new TransformControls(overlayCam, pointerDom);
      controls.setSize(1.25);
      controls.setSpace("world");
      wireControls(controls);
      overlayScene.add(controls.getHelper());
      styleHelper(controls.getHelper());
    } else {
      controls.camera = overlayCam;
      controls.domElement = pointerDom;
    }
    return controls;
  }

  function wireControls(ctrl) {
    ctrl.addEventListener("dragging-changed", (e) => {
      const dragging = !!e.value;
      if (currentId) setPlacementSkipApply(currentId, dragging);
      if (dragging) return;
      if (attachedObj) syncObjectFromProxy(attachedObj);
      commitCurrentOffset();
      pickCooldown = 0.25;
    });
    ctrl.addEventListener("objectChange", () => {
      if (!ctrl.dragging || !attachedObj) return;
      syncObjectFromProxy(attachedObj);
    });
  }

  function collectPickables(api) {
    if (!api?.listTargets || !api?.getObject) return [];
    const meshes = [];
    for (const t of api.listTargets()) {
      const obj = api.getObject(t.id);
      if (!obj) continue;
      obj.userData.placementId = t.id;
      obj.traverse((child) => {
        if (child.isMesh) {
          child.userData._placementPickId = t.id;
          meshes.push(child);
        }
      });
    }
    return meshes;
  }

  function tryPickAt(clientX, clientY, sceneKey) {
    if (!active || pickCooldown > 0) return false;
    if (controls?.dragging) return false;
    if (controls?.axis) return false;
    const api = sceneKey === "player" ? getPlayer() : getWorld();
    if (!api?.camera) return false;
    const viewDom = sharedPointerDom() || api.domElement;
    if (!viewDom) return false;
    const rect = viewDom.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return false;
    }

    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, api.camera);
    const pickables = collectPickables(api);
    if (!pickables.length) return false;
    const hits = raycaster.intersectObjects(pickables, true);
    if (!hits.length) return false;

    let node = hits[0].object;
    while (node) {
      const id = node.userData?._placementPickId || node.userData?.placementId;
      if (id) {
        selectTarget(id);
        return true;
      }
      node = node.parent;
    }
    return false;
  }

  function onPointerDown(event) {
    if (!active || event.button !== 0) return;
    if (panel.contains(event.target) || toggleBtn.contains(event.target)) return;
    if (controls?.dragging) return;
    if (controls?.axis) {
      pendingPick = null;
      return;
    }
    pendingPick = { x: event.clientX, y: event.clientY, t: performance.now() };
  }

  function onPointerUp(event) {
    if (!active || event.button !== 0 || !pendingPick) return;
    const dx = event.clientX - pendingPick.x;
    const dy = event.clientY - pendingPick.y;
    const moved = dx * dx + dy * dy > 36;
    const start = pendingPick;
    pendingPick = null;
    if (moved) return;
    if (controls?.dragging) return;
    if (controls?.axis) return;
    if (panel.contains(event.target) || toggleBtn.contains(event.target)) return;

    if (tryPickAt(start.x, start.y, "player")) return;
    tryPickAt(start.x, start.y, "world");
  }

  function onPointerCancel() {
    pendingPick = null;
  }

  function detachAll() {
    if (currentId) setPlacementSkipApply(currentId, false);
    if (controls) controls.detach();
    attachedObj = null;
    proxyLiftY = 0;
    currentId = "";
    currentSceneKey = "";
  }

  function commitCurrentOffset() {
    const obj = attachedObj;
    if (!obj || !currentId) return;
    const base = obj.userData.placementBase;
    if (!base) return;
    const offset = offsetFromObject(obj, base);
    writePlacementOffset(currentId, offset);
    setStatus(`Saved ${currentId}`);
  }

  function targetListSignature(targets) {
    return targets.map((t) => `${t.id}|${t.label}|${t.scene}`).join(";");
  }

  function refreshTargetList({ force = false } = {}) {
    const targets = [];
    const world = getWorld();
    const player = getPlayer();
    if (world?.listTargets) targets.push(...world.listTargets());
    if (player?.listTargets) targets.push(...player.listTargets());

    const sig = targetListSignature(targets);
    if (!force && sig === lastTargetSig) return targets;
    lastTargetSig = sig;

    const prev = targetSel.value || currentId;
    suppressTargetChange = true;
    targetSel.innerHTML = "";
    for (const t of targets) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label;
      opt.dataset.scene = t.scene;
      targetSel.appendChild(opt);
    }
    if (!targets.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "(enter vault to edit)";
      targetSel.appendChild(opt);
    }
    if (prev && [...targetSel.options].some((o) => o.value === prev)) {
      targetSel.value = prev;
    }
    suppressTargetChange = false;
    return targets;
  }

  function selectTarget(id) {
    if (!id) {
      detachAll();
      return;
    }
    refreshTargetList({ force: true });
    const opt = [...targetSel.options].find((o) => o.value === id);
    const sceneKey =
      opt?.dataset.scene ||
      (id === "player" || id === "torch" ? "player" : "world");
    const api = sceneKey === "player" ? getPlayer() : getWorld();
    const obj = api?.getObject?.(id);
    if (!obj) {
      setStatus(`Missing ${id}`);
      return;
    }

    if (currentId && currentId !== id) setPlacementSkipApply(currentId, false);
    if (controls) controls.detach();

    currentId = id;
    currentSceneKey = sceneKey;
    attachedObj = obj;
    proxyLiftY = gizmoLiftFor(id);
    setPlacementSkipApply(id, false);
    suppressTargetChange = true;
    targetSel.value = id;
    suppressTargetChange = false;

    syncOverlayCamera(api.camera);
    syncProxyFromObject(obj);

    const ctrl = ensureControls();
    if (!ctrl) {
      setStatus("Scene not ready");
      return;
    }
    ctrl.setMode(mode);
    ctrl.enabled = true;
    ctrl.attach(attachProxy);
    styleHelper(ctrl.getHelper());
    syncProxyFromObject(obj);

    const onScreen = isObjectOnScreen(obj, api.camera);
    setStatus(
      onScreen
        ? `Editing ${id} — drag red / green / blue axes`
        : `Selected ${id} — off-screen, WASD/RMB to face it`
    );
  }

  function setMode(next) {
    mode = next;
    modeBtns.forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });
    if (controls) controls.setMode(mode);
  }

  modeBtns.forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  targetSel.addEventListener("change", () => {
    if (suppressTargetChange) return;
    selectTarget(targetSel.value);
  });

  panel.querySelector("#pe-reset")?.addEventListener("click", () => {
    if (!currentId) return;
    removePlacementOffset(currentId);
    setPlacementSkipApply(currentId, false);
    const api = currentSceneKey === "player" ? getPlayer() : getWorld();
    const obj = api?.getObject?.(currentId);
    const base = obj?.userData?.placementBase;
    if (obj && base) {
      obj.position.set(base.position.x, base.position.y, base.position.z);
      obj.rotation.set(base.rotation.x, base.rotation.y, base.rotation.z);
      obj.scale.set(base.scale.x, base.scale.y, base.scale.z);
      attachedObj = obj;
      syncProxyFromObject(obj);
    }
    setStatus(`Reset ${currentId}`);
  });

  panel.querySelector("#pe-reset-all")?.addEventListener("click", () => {
    clearPlacementOffsets();
    detachAll();
    refreshTargetList({ force: true });
    setStatus("Cleared all offsets");
  });

  panel.querySelector("#pe-copy")?.addEventListener("click", async () => {
    const json = JSON.stringify(loadPlacementOffsets(), null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setStatus("Copied offsets JSON");
    } catch {
      setStatus("Copy failed — see console");
      console.log("[placement-editor]", json);
    }
  });

  function setActive(next) {
    const want = !!next;
    if (want === active) {
      syncToggleUi();
      return;
    }
    if (want && !isPlaying()) return;
    active = want;
    panel.classList.toggle("hidden", !active);
    syncToggleUi();
    if (active) {
      invalidatePlacementCache();
      resizeGizmoCanvas();
      refreshTargetList({ force: true });
      if (targetSel.value) selectTarget(targetSel.value);
      else if (targetSel.options[0]?.value) selectTarget(targetSel.options[0].value);
      setStatus("Edit ON — select a target, then drag the RGB axes");
    } else {
      detachAll();
      overlayRenderer.clear();
    }
    onActiveChange(active);
  }

  function toggle() {
    setActive(!active);
  }

  toggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isPlaying() && !active) return;
    toggle();
  });

  powerBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setActive(false);
  });

  function onKeyDown(e) {
    if (!active) return;
    if (e.code === "Digit1" || e.code === "Numpad1") {
      setMode("translate");
      e.preventDefault();
    } else if (e.code === "Digit2" || e.code === "Numpad2") {
      setMode("rotate");
      e.preventDefault();
    } else if (e.code === "Digit3" || e.code === "Numpad3") {
      setMode("scale");
      e.preventDefault();
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("resize", resizeGizmoCanvas);

  function update(dt) {
    const playing = isPlaying();
    toggleBtn.classList.toggle("hidden", !playing && !active);
    if (!active) return;
    if (pickCooldown > 0) pickCooldown = Math.max(0, pickCooldown - dt);
    if (!playing) {
      setActive(false);
      return;
    }
    if (statusTimer > 0) {
      statusTimer -= dt;
      if (statusTimer <= 0 && statusEl && statusEl.textContent.startsWith("Saved")) {
        statusEl.textContent = currentId ? `Editing ${currentId}` : "";
      }
    }

    const before = currentId || targetSel.value;
    refreshTargetList();
    if (before && currentId === before) {
      if (!controls?.object) {
        selectTarget(before);
      } else if (attachedObj && !controls.dragging) {
        syncProxyFromObject(attachedObj);
      }
    } else if (!currentId && targetSel.value) {
      selectTarget(targetSel.value);
    }
  }

  function renderOverlays() {
    if (!active) return;
    resizeGizmoCanvas();
    if (!controls?.object) {
      overlayRenderer.clear();
      return;
    }
    const api = currentSceneKey === "player" ? getPlayer() : getWorld();
    if (!api?.camera) {
      overlayRenderer.clear();
      return;
    }
    syncOverlayCamera(api.camera);
    if (attachedObj && !controls.dragging) syncProxyFromObject(attachedObj);
    overlayRenderer.render(overlayScene, overlayCam);
  }

  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("resize", resizeGizmoCanvas);
    detachAll();
    if (controls) {
      controls.dispose();
      controls = null;
    }
    overlayRenderer.dispose();
    gizmoCanvas.remove();
    panel.remove();
    toggleBtn.remove();
  }

  syncToggleUi();

  return {
    get active() {
      return active;
    },
    setActive,
    toggle,
    update,
    renderOverlays,
    dispose,
    refreshTargetList,
    isBlockingPointer() {
      return active && !!controls?.dragging;
    },
  };
}

export function shouldAutoOpenPlacementEditor() {
  try {
    // Development-only: ignore ?edit=1 anywhere except a local test server.
    const h = window.location.hostname;
    const isLocal = h === "localhost" || h === "127.0.0.1" || h === "[::1]";
    if (!isLocal) return false;
    return new URLSearchParams(window.location.search).get("edit") === "1";
  } catch {
    return false;
  }
}
