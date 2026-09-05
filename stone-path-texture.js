/* ============================================
   Last Light: Mimu Vault — stone path floor texture
   Seamless cracked-slab flagstone with faint crystal
   veins seeping up through the cracks.

   Pure canvas (no three.js import) so it can be
   previewed standalone in stone-path-preview.html.
   ============================================ */

/** Small deterministic PRNG so a given seed always makes the same floor. */
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw the same thing at every wrapped offset so anything crossing an edge
 * reappears on the opposite side — this is what makes the tile seamless.
 */
function drawWrapped(size, drawFn) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      drawFn(dx * size, dy * size);
    }
  }
}

const DEFAULTS = {
  size: 512,
  seed: 20260730,
  rows: 4,
  /** Total crack width between slabs, in texture px. */
  gap: 5,
  /** How strongly crystal light seeps through the cracks (0 = plain stone). */
  veinStrength: 0.55,
};

/**
 * Build the floor texture and return the canvas.
 * Tiles seamlessly against itself in both directions.
 */
export function createStonePathCanvas(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const { size, rows, gap } = cfg;
  const rand = mulberry32(cfg.seed);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // ── 1. Crack bed ──────────────────────────────────────────────────
  // Near-black with a cold blue cast. Slabs sit on top of this, so
  // whatever we paint now survives only in the gaps between them.
  ctx.fillStyle = "#0d0b14";
  ctx.fillRect(0, 0, size, size);

  // ── 2. Crystal light under the stone ──────────────────────────────
  // A few veins wander across the tile, then the slabs are laid on top.
  // Only the stretches passing under a crack survive, so the glow shows
  // up as broken glimmers following a path — not an outline on every slab.
  if (cfg.veinStrength > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const veins = 3;
    for (let v = 0; v < veins; v++) {
      // Random walk with gentle drift so the vein meanders like a fracture.
      const pts = [];
      let px = rand() * size;
      let py = rand() * size;
      let angle = rand() * Math.PI * 2;
      const steps = 16 + Math.floor(rand() * 10);
      for (let s = 0; s < steps; s++) {
        pts.push([px, py]);
        angle += (rand() - 0.5) * 1.1;
        const step = size * (0.05 + rand() * 0.05);
        px += Math.cos(angle) * step;
        py += Math.sin(angle) * step;
      }

      const hue = 220 + rand() * 44;
      const peak = (0.5 + rand() * 0.35) * cfg.veinStrength;

      drawWrapped(size, (ox, oy) => {
        // Three passes: broad halo, core, hot centre.
        const passes = [
          { width: 26, alpha: peak * 0.1, light: 46 },
          { width: 11, alpha: peak * 0.22, light: 58 },
          { width: 4, alpha: peak * 0.5, light: 70 },
        ];
        for (const p of passes) {
          ctx.strokeStyle = `hsla(${hue}, 94%, ${p.light}%, ${p.alpha})`;
          ctx.lineWidth = p.width;
          ctx.beginPath();
          ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i][0] + ox, pts[i][1] + oy);
          }
          ctx.stroke();
        }
      });
    }
    ctx.restore();
  }

  // ── 3. Slabs ──────────────────────────────────────────────────────
  // Running-bond rows. Each row's widths are forced to sum to exactly
  // `size` and the row is then shifted, so slabs wrap cleanly.
  const rowH = size / rows;
  const half = gap / 2;

  for (let r = 0; r < rows; r++) {
    const widths = [];
    let used = 0;
    const minW = size * 0.16;
    const maxW = size * 0.34;
    while (size - used > maxW) {
      const w = minW + rand() * (maxW - minW);
      widths.push(w);
      used += w;
    }
    // Whatever is left becomes the final slab, keeping the row exactly `size` wide.
    widths.push(size - used);

    const shift = rand() * size;
    let x = shift;

    for (const w of widths) {
      drawSlab(
        ctx,
        size,
        rand,
        x + half,
        r * rowH + half,
        w - gap,
        rowH - gap
      );
      x += w;
    }
  }

  // ── 4. Grime pass ─────────────────────────────────────────────────
  // Large soft dark patches over everything, so repeated tiles don't
  // read as an obvious grid of identical stones.
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const bx = rand() * size;
    const by = rand() * size;
    const radius = 70 + rand() * 130;
    const a = 0.05 + rand() * 0.12;
    drawWrapped(size, (ox, oy) => {
      const g = ctx.createRadialGradient(bx + ox, by + oy, 0, bx + ox, by + oy, radius);
      g.addColorStop(0, `rgba(8, 6, 14, ${a})`);
      g.addColorStop(1, "rgba(8, 6, 14, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx + ox, by + oy, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();

  return canvas;
}

/** One flagstone: base tone, speckle, baked bevel, worn corners. */
function drawSlab(ctx, size, rand, x, y, w, h) {
  if (w <= 0 || h <= 0) return;

  // Dark neutral stone. Kept desaturated and fairly dark so the glowing
  // crystal walls stay the brightest thing in the room, and so the floor
  // material's own tint does the colour work rather than the texture.
  const light = 16 + rand() * 9;
  const hue = 250 + rand() * 20;
  const sat = 3 + rand() * 5;
  const radius = 3 + rand() * 3;

  drawWrapped(size, (ox, oy) => {
    const px = x + ox;
    const py = y + oy;

    // Cheap bail-out: skip copies that can't touch the canvas.
    if (px > size || py > size || px + w < 0 || py + h < 0) return;

    ctx.save();
    roundedRect(ctx, px, py, w, h, radius);
    ctx.clip();

    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
    ctx.fillRect(px, py, w, h);

    // Speckle — fine mineral grain across the face.
    const grains = Math.floor((w * h) / 26);
    for (let i = 0; i < grains; i++) {
      const gx = px + rand() * w;
      const gy = py + rand() * h;
      const bright = rand() > 0.5;
      const a = 0.03 + rand() * 0.1;
      ctx.fillStyle = bright
        ? `rgba(226, 224, 236, ${a})`
        : `rgba(18, 15, 26, ${a})`;
      ctx.fillRect(gx, gy, 1, 1);
    }

    // Faint mottling so each slab has its own weathering.
    for (let i = 0; i < 5; i++) {
      const mx = px + rand() * w;
      const my = py + rand() * h;
      const mr = 6 + rand() * 22;
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
      const dark = rand() > 0.5;
      g.addColorStop(0, dark ? "rgba(20, 17, 30, 0.16)" : "rgba(210, 208, 224, 0.1)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Baked bevel: catches light on the top/left, shadow on the bottom/right.
    // Gives the slabs depth even under the game's very flat ambient light.
    const bevel = 2.5;
    ctx.fillStyle = "rgba(228, 226, 242, 0.075)";
    ctx.fillRect(px, py, w, bevel);
    ctx.fillRect(px, py, bevel, h);
    ctx.fillStyle = "rgba(10, 8, 18, 0.34)";
    ctx.fillRect(px, py + h - bevel, w, bevel);
    ctx.fillRect(px + w - bevel, py, bevel, h);

    ctx.restore();
  });
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
