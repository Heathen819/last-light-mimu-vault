# Deploying Last Light: Mimu Vault to Netlify

## Quick start

1. **Build the deploy folder** (double-click or run in Terminal):

   ```bash
   ./pack-for-netlify.sh
   ```

   Or double-click `pack-for-netlify.command` on macOS (opens the folder when done).

2. **Upload to Netlify**

   - Go to [https://app.netlify.com/drop](https://app.netlify.com/drop)
   - Drag the entire **`Mimu Vault Deploy`** folder onto the page
   - Do **not** upload individual files — Netlify needs the folder structure

3. **Test the live site**

   - Open the URL Netlify gives you
   - Hard refresh: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows)

---

## What gets packed

| Item | Purpose |
|------|---------|
| `index.html`, `style.css` | Page shell + HUD |
| `game.js` | Game loop, input, HUD |
| `world3d.js` | 3D cave maze, lanterns, enemies |
| `player3d.js` | 3D banker avatar + torch bloom |
| `enemysprite.js` | Shadow creature sprite helper |
| `assets/player/banker_new_4_animated.glb` | Player model (~59 MB) |
| `assets/enemies/shadow-creature-new.glb` | Shadow enemy (~60 MB) |
| `assets/objects/lanterns/rock-crystal-lantern.glb` | Lantern model |
| `assets/environment/cave-walls/*.png` | Cave wall textures (7) |
| `assets/environment/crystal-cave-ref.jpg` | Floor/ceiling reference |
| `assets/ui/*` | Menu logo, button, background |
| `assets/fonts/`, `assets/audio/theme.mp3` | Font + music |

**Total size:** ~130 MB (mostly the two large GLB models).

**CDN dependency:** Three.js loads from `unpkg.com` — players need an internet connection.

---

## Git-connected Netlify site

If the repo is linked to Netlify, use these settings:

| Setting | Value |
|---------|-------|
| Build command | `bash pack-for-netlify.sh` |
| Publish directory | `Mimu Vault Deploy` |

The root `netlify.toml` is already configured for this.

---

## Updating an existing site

1. Make your game changes in the project folder
2. Run `./pack-for-netlify.sh` again
3. Drag **`Mimu Vault Deploy`** to Netlify Drop again (replaces the deploy)

Or push to Git if the site is connected — Netlify will rebuild automatically.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Black screen / no maze | Hard refresh; check browser console for 404s on `.glb` or `.js` |
| Old version still showing | Cache bust: bump `?v=` in `index.html` / `game.js` imports, repack, redeploy |
| Upload fails / too large | Netlify free tier allows large sites; ensure you're uploading the whole folder |
| No 3D / missing textures | Confirm `world3d.js`, `player3d.js`, and `assets/environment/cave-walls/` are in the deploy folder |

---

## Files you do **not** need to upload

The pack script excludes dev-only files: archives, notes, `.cursor/`, tuning HTML grids, unused GLB variants, and the full `assets/` tree. Only the lean **`Mimu Vault Deploy`** folder goes to Netlify.
