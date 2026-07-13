# Bloom position — LOCKED (Jul 2026)

**Keep bloom here** while avatar / torch / GLB work continues. Bloom is **screen-anchored**, not tied to the torch mesh or ember node.

## Locked values (`player3d.js` → `BLOOM_TORCH_LOCK`)

| Setting | Value | Notes |
|--------|-------|-------|
| Grid cell | **K4** | Star on torch crystal tip (user markup) |
| Screen anchor | `(476/752, 225/553)` ≈ `(0.633, 0.407)` | Normalized viewport |
| Pixel nudge | **x: 0**, **y: 0** | Grid click — no extra nudge |
| Bloom pass | strength `0.16`, radius `0.36`, threshold `0.42` | UnrealBloomPass |
| Bloom quality | strength `1.4`, radius `0.42`, threshold `0.36` | `setBloom()` defaults |

## Architecture (do not revert)

- Bloom orbs live on **`scene`**, positioned each frame via `screenAnchorToWorld()` + nudge.
- **Do not** parent bloom orbs to `flameAnchor`, `bloomAnchor`, or torch nodes.
- **Do not** drive bloom from `Icosphere.003`, `Object_4`, or `FLAME_LOCAL_OFFSET`.
- Lights and flame mesh may follow torch; **bloom stays at screen K4 + nudge**.

## Safe to change when updating avatar/torch

- `MODEL_URL`, rig animation, walk bob, torch mesh visibility
- `FLAME_LOCAL_OFFSET` (flame / lights only)
- `POINT_LIGHT_SCREEN` (point light only)
- GLB flame shader, `Object_4` material

## Re-tune bloom only when intentional

Console (in vault):

```js
window.__player3d.getBloomTuning();
window.__player3d.setBloomNudge({ x: 0, y: 0 });
window.__player3d.setBloomScreen({ x: 0.633, y: 0.407 });
```

Grid reference tool: `assets/ui/bloom-position-grid.html`

## Cache bust when changing lock values

Update `?v=banker_new_*` in `game.js` and `index.html`.
