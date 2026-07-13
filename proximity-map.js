/* ============================================
   Torch-lit proximity map — follows the player
   Only tiles inside the flame pool are visible.
   ============================================ */

const MAP_SIZE = 148;
const PX_PER_TILE = 11;
const LANTERN_MAP_RADIUS = 3.2;
const LANTERN_MAP_STRENGTH = 0.55;

function sampleIllum(wx, wy, player, viewDist, lanterns) {
  let illum = 0;
  const pd = Math.hypot(wx - player.x, wy - player.y);
  if (pd <= viewDist) {
    const t = 1 - pd / viewDist;
    illum = Math.max(illum, t * t);
  }
  for (const l of lanterns) {
    if (!l.lit) continue;
    const ld = Math.hypot(wx - l.x, wy - l.y);
    if (ld <= LANTERN_MAP_RADIUS) {
      const t = 1 - ld / LANTERN_MAP_RADIUS;
      illum = Math.max(illum, t * LANTERN_MAP_STRENGTH);
    }
  }
  return illum;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ levelMap: number[][], mapRows: number, mapCols: number }} opts
 */
export function createProximityMap(canvas, opts) {
  const { levelMap, mapRows, mapCols } = opts;
  const ctx = canvas.getContext("2d");
  const half = MAP_SIZE / 2;
  const tileRadius = Math.ceil(half / PX_PER_TILE) + 1;

  // Reused each frame — no per-frame allocations.
  const floorFill = ctx.createLinearGradient(0, 0, MAP_SIZE, MAP_SIZE);
  floorFill.addColorStop(0, "rgba(88, 72, 128, 0.92)");
  floorFill.addColorStop(1, "rgba(58, 44, 96, 0.92)");
  const wallFill = "rgba(36, 24, 62, 0.95)";

  function draw(data) {
    if (!ctx || !data?.player) return;

    const { player, lanterns = [], shadows = [], exit, viewDist } = data;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#03020a";
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

    const playerCol = Math.floor(player.x);
    const playerRow = Math.floor(player.y);
    const cell = PX_PER_TILE - 1;

    for (let dr = -tileRadius; dr <= tileRadius; dr += 1) {
      for (let dc = -tileRadius; dc <= tileRadius; dc += 1) {
        const row = playerRow + dr;
        const col = playerCol + dc;
        if (row < 0 || col < 0 || row >= mapRows || col >= mapCols) continue;

        const wx = col + 0.5;
        const wy = row + 0.5;
        const illum = sampleIllum(wx, wy, player, viewDist, lanterns);
        if (illum <= 0.03) continue;

        const sx = half + dc * PX_PER_TILE - cell / 2;
        const sy = half + dr * PX_PER_TILE - cell / 2;
        ctx.globalAlpha = Math.min(1, illum);

        if (levelMap[row][col] === 1) {
          ctx.fillStyle = wallFill;
        } else {
          ctx.fillStyle = floorFill;
        }
        ctx.fillRect(sx, sy, cell, cell);
      }
    }

    ctx.globalAlpha = 1;

    // Lit lanterns visible inside the torch pool.
    for (const l of lanterns) {
      if (!l.lit) continue;
      const illum = sampleIllum(l.x, l.y, player, viewDist, lanterns);
      if (illum <= 0.05) continue;
      const sx = half + (l.x - player.x) * PX_PER_TILE;
      const sy = half + (l.y - player.y) * PX_PER_TILE;
      ctx.fillStyle = `rgba(255, 210, 90, ${0.55 + illum * 0.45})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Exit marker when the flame reaches it.
    if (exit) {
      const illum = sampleIllum(exit.x, exit.y, player, viewDist, lanterns);
      if (illum > 0.05) {
        const sx = half + (exit.x - player.x) * PX_PER_TILE;
        const sy = half + (exit.y - player.y) * PX_PER_TILE;
        ctx.fillStyle = exit.unlocked
          ? "rgba(90, 240, 255, 0.95)"
          : "rgba(255, 170, 70, 0.85)";
        ctx.fillRect(sx - 3, sy - 3, 6, 6);
      }
    }

    // Nulls only appear when the torch light catches them.
    for (const s of shadows) {
      const illum = sampleIllum(s.x, s.y, player, viewDist, lanterns);
      if (illum <= 0.08) continue;
      const sx = half + (s.x - player.x) * PX_PER_TILE;
      const sy = half + (s.y - player.y) * PX_PER_TILE;
      ctx.fillStyle = `rgba(160, 90, 220, ${0.45 + illum * 0.5})`;
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player always at center; map scrolls underneath.
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(player.angle);
    ctx.fillStyle = "rgba(255, 200, 87, 0.98)";
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, -4.5);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Soft circular edge so the lit pool fades into darkness.
    const edge = ctx.createRadialGradient(half, half, half * 0.42, half, half, half);
    edge.addColorStop(0, "rgba(0, 0, 0, 0)");
    edge.addColorStop(0.72, "rgba(0, 0, 0, 0)");
    edge.addColorStop(1, "rgba(0, 0, 0, 0.92)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
  }

  return { draw, size: MAP_SIZE };
}
