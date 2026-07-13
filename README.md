# Last Light: Mimu Vault

A small cozy-horror browser game prototype. Carry the last flame through a dark vault, light lanterns, avoid shadows, and escape.

## How to run

Open `index.html` in a modern browser (Chrome, Firefox, Safari, Edge).

Or serve locally:

```bash
npx serve .
```

Then open the URL shown in the terminal (usually `http://localhost:3000`).

## Controls

| Key | Action |
|-----|--------|
| WASD | Move / strafe |
| ← → or Q | Look left / right |
| Click canvas | Mouse look (pointer lock) |
| E | Light a nearby lantern / exit through the unlocked door |
| R | Restart |
| Esc | Return to main menu |

## Main menu

The game opens on a main menu with the MV logo and a **Music** volume control (slider + mute). Volume is saved in the browser. When you add a theme track at `assets/audio/theme.mp3`, uncomment the music lines in `game.js` to hook it up.

## Goal

1. Keep your flame alive (watch the light meter).
2. Light all 3 lanterns.
3. Reach the glowing exit door and press **E**.

Stand near lit lanterns to recharge. Avoid the purple shadow hazards — they drain your light quickly.

## Project structure

```
Last Light Mimu Vault/
├── index.html          # Page shell + HUD
├── style.css           # UI styling
├── game.js             # All game systems
└── assets/             # Drop replacement art here
    ├── player/
    ├── lanterns/
    ├── enemies/
    ├── environment/
    ├── ui/
    └── audio/
```

## Replacing placeholder art

Placeholders are drawn with Canvas shapes in `game.js`. When you have sprites:

1. Put image files in the matching `assets/` folder.
2. Load them near the top of `game.js` (e.g. `new Image()` + `onload`).
3. Swap the draw calls in:
   - `drawPlayer()` → `assets/player/`
   - `drawLanterns()` → `assets/lanterns/`
   - `drawShadows()` → `assets/enemies/`
   - `drawExit()` / walls → `assets/environment/`

Suggested filenames: `mimu.png`, `lantern-off.png`, `lantern-on.png`, `shadow.png`, `door-locked.png`, `door-open.png`.

## What to build next

- Real Mimu / lantern / vault sprites
- Sound (footsteps, lantern light, flame flicker, win/lose)
- More rooms / a second level
- Shadow AI that chases when the player’s light is low
- Particles for flame and lantern sparks
- Mobile touch controls
