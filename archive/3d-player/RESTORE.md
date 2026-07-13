# 3D player + torch (saved snapshot)

Saved: banker avatar + external torch + flame sprite sheets (v1).

## Files in this archive

- `player3d-banker-torch-v1.js` — full Three.js overlay module

## Assets used by 3D mode (keep in project root / assets/)

- `player3d.js` (active copy — same as this archive when saved)
- `torch_flame_animation_2.0.glb`
- `assets/player/banker1.0_withAnimation_andTorch.glb`
- `assets/objects/torch-flame-orange-sheet.png`
- `assets/objects/torch-flame-red-sheet.png`
- `assets/objects/torch-flame-blue-sheet.png`

## Switch back to 3D

1. In `game.js`, set `USE_3D_PLAYER = true`
2. In `pack-for-netlify.sh`, set `INCLUDE_3D_PLAYER=1` (for lean deploys)
3. Hard refresh the browser

## Switch to 2D (current default)

1. In `game.js`, set `USE_3D_PLAYER = false`
2. In `pack-for-netlify.sh`, set `INCLUDE_3D_PLAYER=0`
3. Game uses `assets/player/mimu-fp.png` on the main canvas
