#!/bin/bash
# Double-click this file to build the game and put a ready-to-send
# .zip on your Desktop. No terminal knowledge needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/Mimu Vault Deploy"
DESKTOP="$HOME/Desktop"
STAMP="$(date +%Y-%m-%d)"
ZIP="$DESKTOP/Last-Light-Mimu-Vault-$STAMP.zip"

echo ""
echo "=============================================="
echo " Last Light: Mimu Vault — build a file to send"
echo "=============================================="
echo ""

echo "Step 1 of 2: packing the game files..."
bash "$ROOT/pack-for-netlify.sh"

echo ""
echo "Step 2 of 2: zipping it for sending..."
rm -f "$ZIP"

# ditto is the macOS-native zipper; its archives always open cleanly in Finder.
if command -v ditto >/dev/null 2>&1; then
  ditto -c -k --sequesterRsrc --keepParent "$SRC" "$ZIP"
else
  ( cd "$ROOT" && zip -r -q "$ZIP" "Mimu Vault Deploy" -x '*.DS_Store' )
fi

SIZE="$(du -h "$ZIP" | cut -f1)"

echo ""
echo "=============================================="
echo " Done."
echo ""
echo "  File:  $(basename "$ZIP")"
echo "  Where: your Desktop"
echo "  Size:  $SIZE"
echo ""
echo " This is too big to email. Send it with"
echo " WeTransfer, Google Drive, or Dropbox."
echo "=============================================="
echo ""

# Reveal the finished zip in Finder.
open -R "$ZIP" 2>/dev/null || open "$DESKTOP" 2>/dev/null || true
