#!/bin/bash
# Assemble production frontend into dist/ directory
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$SCRIPT_DIR/dist"

rm -rf "$DIST"
mkdir -p "$DIST"

# Copy frontend source
cp "$SCRIPT_DIR/src/index.html" "$DIST/"
cp "$SCRIPT_DIR/src/style.css" "$DIST/"
cp "$SCRIPT_DIR/src/app.js" "$DIST/"
cp "$SCRIPT_DIR/src/state.js" "$DIST/"
cp "$SCRIPT_DIR/src/chat.js" "$DIST/"

# Copy web assets
mkdir -p "$DIST/web"
cp "$SCRIPT_DIR/web/spine.js" "$DIST/web/"
cp "$SCRIPT_DIR/web/live2d-tauri.js" "$DIST/web/"
cp "$SCRIPT_DIR/web/mmd-tauri.js" "$DIST/web/"

# Libraries
cp -R "$SCRIPT_DIR/web/lib" "$DIST/web/lib"

# Models (all characters with assets)
cp -R "$SCRIPT_DIR/web/model" "$DIST/web/model"

echo "Build assembled: dist/ ($(du -sh "$DIST" | cut -f1))"
