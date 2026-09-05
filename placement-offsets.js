/* ============================================
   Placement offsets — shared storage + apply
   Visual/layout layer for props, exit, player, torch.
   ============================================ */

export const PLACEMENT_STORAGE_KEY = "mimu.placementOffsets.v1";

export const PLACEMENT_IDENTITY = Object.freeze({
  position: Object.freeze([0, 0, 0]),
  rotation: Object.freeze([0, 0, 0]),
  scale: Object.freeze([1, 1, 1]),
});

/** Targets currently driven by TransformControls — sync skips re-applying. */
const skipApplyIds = new Set();

let cachedOffsets = null;

function cloneOffset(src) {
  const o = src || PLACEMENT_IDENTITY;
  return {
    position: [...(o.position || PLACEMENT_IDENTITY.position)],
    rotation: [...(o.rotation || PLACEMENT_IDENTITY.rotation)],
    scale: [...(o.scale || PLACEMENT_IDENTITY.scale)],
  };
}

export function loadPlacementOffsets() {
  if (cachedOffsets) return cachedOffsets;
  try {
    const raw = localStorage.getItem(PLACEMENT_STORAGE_KEY);
    cachedOffsets = raw ? JSON.parse(raw) : {};
    if (!cachedOffsets || typeof cachedOffsets !== "object") cachedOffsets = {};
  } catch {
    cachedOffsets = {};
  }
  return cachedOffsets;
}

export function savePlacementOffsets(data) {
  cachedOffsets = data && typeof data === "object" ? data : {};
  try {
    localStorage.setItem(PLACEMENT_STORAGE_KEY, JSON.stringify(cachedOffsets));
  } catch {
    /* quota / private mode */
  }
  return cachedOffsets;
}

export function clearPlacementOffsets() {
  cachedOffsets = {};
  try {
    localStorage.removeItem(PLACEMENT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function invalidatePlacementCache() {
  cachedOffsets = null;
}

export function resolvePlacementOffset(id, offsets = loadPlacementOffsets()) {
  const type = String(id).split(":")[0];
  const merged = {
    ...PLACEMENT_IDENTITY,
    ...(offsets[type] || {}),
    ...(offsets[id] || {}),
  };
  const out = cloneOffset(merged);
  // Guard against corrupted saves that would make meshes vanish.
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(out.scale[i]) || Math.abs(out.scale[i]) < 1e-4) {
      out.scale[i] = 1;
    }
    if (!Number.isFinite(out.position[i])) out.position[i] = 0;
    if (!Number.isFinite(out.rotation[i])) out.rotation[i] = 0;
  }
  return out;
}

export function setPlacementSkipApply(id, skip) {
  if (!id) return;
  if (skip) skipApplyIds.add(id);
  else skipApplyIds.delete(id);
}

export function shouldSkipPlacementApply(id) {
  return skipApplyIds.has(id);
}

/**
 * @param {{ position: {x:number,y:number,z:number}, rotation: {x:number,y:number,z:number}, scale: {x:number,y:number,z:number} }} base
 */
export function applyPlacementOffset(obj, offset, base) {
  if (!obj || !base) return;
  const off = offset || PLACEMENT_IDENTITY;
  const p = off.position || PLACEMENT_IDENTITY.position;
  const r = off.rotation || PLACEMENT_IDENTITY.rotation;
  const s = off.scale || PLACEMENT_IDENTITY.scale;
  obj.position.set(
    base.position.x + p[0],
    base.position.y + p[1],
    base.position.z + p[2]
  );
  obj.rotation.set(
    base.rotation.x + r[0],
    base.rotation.y + r[1],
    base.rotation.z + r[2]
  );
  obj.scale.set(
    base.scale.x * s[0],
    base.scale.y * s[1],
    base.scale.z * s[2]
  );
}

/**
 * Capture offset of obj relative to logical base pose.
 */
export function offsetFromObject(obj, base) {
  if (!obj || !base) return cloneOffset(PLACEMENT_IDENTITY);
  const sx = base.scale.x || 1;
  const sy = base.scale.y || 1;
  const sz = base.scale.z || 1;
  return {
    position: [
      obj.position.x - base.position.x,
      obj.position.y - base.position.y,
      obj.position.z - base.position.z,
    ],
    rotation: [
      obj.rotation.x - base.rotation.x,
      obj.rotation.y - base.rotation.y,
      obj.rotation.z - base.rotation.z,
    ],
    scale: [obj.scale.x / sx, obj.scale.y / sy, obj.scale.z / sz],
  };
}

export function writePlacementOffset(id, offset) {
  const all = { ...loadPlacementOffsets() };
  all[id] = cloneOffset(offset);
  return savePlacementOffsets(all);
}

export function removePlacementOffset(id) {
  const all = { ...loadPlacementOffsets() };
  delete all[id];
  return savePlacementOffsets(all);
}

/** Store base pose on the object for the editor to read on drag-end. */
export function stampPlacementBase(obj, id, base) {
  if (!obj) return;
  obj.userData.placementId = id;
  obj.userData.placementBase = {
    position: { x: base.position.x, y: base.position.y, z: base.position.z },
    rotation: { x: base.rotation.x, y: base.rotation.y, z: base.rotation.z },
    scale: { x: base.scale.x, y: base.scale.y, z: base.scale.z },
  };
}

/**
 * Apply resolved offset unless the editor is actively transforming this id.
 */
export function applyPlacementFor(obj, id, base) {
  stampPlacementBase(obj, id, base);
  if (shouldSkipPlacementApply(id)) return;
  applyPlacementOffset(obj, resolvePlacementOffset(id), base);
}
