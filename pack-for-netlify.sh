#!/bin/bash
# Builds a static folder for Netlify drag-and-drop or git deploy.
# Includes the current 3D world + 3D player build (cave maze, lanterns, bloom).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="$ROOT/Mimu Vault Deploy"
BUILD_TAG="$(date +%Y-%m-%d)"

rm -rf "$DEST"
mkdir -p \
  "$DEST/assets/player" \
  "$DEST/assets/enemies" \
  "$DEST/assets/objects/lanterns" \
  "$DEST/assets/environment/cave-walls" \
  "$DEST/assets/ui" \
  "$DEST/assets/avatars" \
  "$DEST/assets/fonts" \
  "$DEST/assets/audio" \
  "$DEST/assets/audio/music" \
  "$DEST/assets/audio/sfx" \
  "$DEST/assets/characters/villains"

echo "Packing core files..."
cp "$ROOT/index.html" "$ROOT/leaderboard.html" "$ROOT/lore.html" "$ROOT/sign-in.html" "$ROOT/profile.html" "$ROOT/style.css" "$DEST/"
cp "$ROOT/game.js" "$ROOT/world3d.js" "$ROOT/player3d.js" "$ROOT/enemysprite.js" "$ROOT/site-nav.js" "$ROOT/ui-sfx.js" "$ROOT/auth.js" "$ROOT/music-player.js" "$ROOT/proximity-map.js" "$ROOT/placement-offsets.js" "$ROOT/placement-editor.js" "$ROOT/stone-path-texture.js" "$DEST/"

echo "Packing 3D models..."
# Decimated banker avatar (61k tris / 9.6 MB, down from 1.96M tris / 79 MB).
cp "$ROOT/assets/player/banker_torch_animated_19_decimated.glb" "$DEST/assets/player/"
# Decimated Null enemies (~550k tris / 23 MB each, down from 4M tris / 96 MB).
cp "$ROOT/assets/enemies/green_Null_decimated_small.glb" "$DEST/assets/enemies/"
cp "$ROOT/assets/enemies/purple_Null_decimated_small.glb" "$DEST/assets/enemies/"
cp "$ROOT/assets/objects/lanterns/rock-crystal-lantern.glb" "$DEST/assets/objects/lanterns/"
cp "$ROOT/torch_flame_animation_2.0.glb" "$DEST/" 2>/dev/null || true

echo "Packing environment..."
# Only the wall sets world3d.js actually loads (v1 + v2). The unversioned
# cave-wall-0X.png and new-cave-wall-X.PNG copies are unreferenced originals.
cp "$ROOT/assets/environment/crystal-cave-ref.jpg" "$DEST/assets/environment/"
mkdir -p "$DEST/assets/environment/cave-walls/v1" "$DEST/assets/environment/cave-walls/v2"
cp "$ROOT/assets/environment/cave-walls/v1/"*.png "$DEST/assets/environment/cave-walls/v1/"
cp "$ROOT/assets/environment/cave-walls/v2/"*.png "$DEST/assets/environment/cave-walls/v2/"

echo "Packing UI + audio..."
cp "$ROOT/assets/ui/menu-glyph.png" "$DEST/assets/ui/"
cp "$ROOT/assets/ui/last-light-logo.png" "$DEST/assets/ui/"
cp "$ROOT/assets/ui/menu-logo-loop.mp4" "$DEST/assets/ui/"
cp "$ROOT/assets/ui/enter-vault-btn.png" "$DEST/assets/ui/"
cp "$ROOT/assets/ui/vault-menu-bg.png" "$DEST/assets/ui/"
cp "$ROOT/assets/avatars/"*.png "$DEST/assets/avatars/"
cp "$ROOT/assets/fonts/BreatheFireIii-PKLOB.ttf" "$DEST/assets/fonts/"
cp "$ROOT/assets/fonts/AlienAlphabet-nRRqJ.otf" "$DEST/assets/fonts/"
cp "$ROOT/assets/fonts/MimuGlyphScript.ttf" "$DEST/assets/fonts/"
# Audio: only tracks referenced by music-player.js (menu), game.js (in-game),
# and ui-sfx.js (button push). Everything else in assets/audio is unused.
cp "$ROOT/assets/audio/Tilt-a-whisper edited.mp3" "$DEST/assets/audio/"
cp "$ROOT/assets/audio/music/Vault of Echoes in-game.mp3" "$DEST/assets/audio/music/"
cp "$ROOT/assets/audio/sfx/mixkit-creepy-cavern-ambience-loop-2492.wav" "$DEST/assets/audio/sfx/"
cp "$ROOT/assets/audio/sfx/mixkit-heavy-sword-hit-2794.wav" "$DEST/assets/audio/sfx/"
cp "$ROOT/assets/audio/sfx/mixkit-positive-game-alert-3151.wav" "$DEST/assets/audio/sfx/"
cp "$ROOT/assets/audio/mixkit-fire-swoosh-burning-1328.wav" "$DEST/assets/audio/"
cp "$ROOT/assets/audio/mixkit-single-zombie-breath-2233.wav" "$DEST/assets/audio/"
cp "$ROOT/assets/player/mimu-fp.png" "$DEST/assets/player/" 2>/dev/null || true
cp "$ROOT/assets/characters/villains/"*.png "$DEST/assets/characters/villains/" 2>/dev/null || true

echo "Packing auth + leaderboard backend..."
mkdir -p "$DEST/netlify/functions" "$DEST/netlify/lib"
cp "$ROOT/netlify/functions/"*.mjs "$DEST/netlify/functions/"
cp "$ROOT/netlify/lib/"*.mjs "$DEST/netlify/lib/"
cp "$ROOT/package.json" "$DEST/"

cat > "$DEST/netlify.toml" << 'EOF'
[build]
  publish = "."
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "20"

[functions]
  node_bundler = "esbuild"
  included_files = ["./netlify/lib/**"]

[[headers]]
  for = "/*.glb"
  [headers.values]
    Content-Type = "model/gltf-binary"

[[headers]]
  for = "/assets/enemies/*.glb"
  [headers.values]
    Content-Type = "model/gltf-binary"
    Cache-Control = "public, max-age=0, must-revalidate"

[[headers]]
  for = "/*.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=604800"
EOF

cat > "$DEST/README.txt" << EOF
Last Light: Mimu Vault — Netlify deploy folder
Packed: $BUILD_TAG

Upload this ENTIRE folder to Netlify (not individual files inside it).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPTION A — Drag & drop (fastest)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  1. Run pack-for-netlify.command (or ./pack-for-netlify.sh) in the project folder
  2. Go to https://app.netlify.com/drop
  3. Drag this "Mimu Vault Deploy" folder onto the page
  4. Wait for upload (~360 MB — banker, shadow, and torch-flame GLBs are large)
  5. Hard refresh the live site after deploy (Cmd+Shift+R / Ctrl+Shift+R)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OPTION B — Git-connected site
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Build command:    bash pack-for-netlify.sh
  Publish directory: Mimu Vault Deploy

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
What's included
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • 3D cave maze (world3d.js + cave wall textures)
  • 3D banker avatar + torch bloom (player3d.js)
  • Crystal lanterns, shadow creatures, menu UI, theme audio
  • Sign-in profiles + global leaderboard (Netlify Functions)
  • Three.js loaded from unpkg CDN (needs internet)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Global leaderboard (profiles + scores)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  This deploy folder now includes Netlify Functions.
  After deploy, set in Netlify → Site settings → Environment variables:
    AUTH_SECRET = a long random string (keep private)
  Then trigger a fresh deploy.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After game changes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Re-run pack-for-netlify.sh, then redeploy this folder.
EOF

TOTAL="$(du -sh "$DEST" | awk '{print $1}')"
FILE_COUNT="$(find "$DEST" -type f | wc -l | tr -d ' ')"

echo ""
echo "Packed deploy folder:"
echo "  $DEST"
echo "  Size: $TOTAL ($FILE_COUNT files)"
echo ""
echo "Ready for Netlify — drag 'Mimu Vault Deploy' to https://app.netlify.com/drop"
