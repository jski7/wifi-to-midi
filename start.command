#!/bin/bash
# Double-click this file in Finder to start WiFi to MIDI.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install it from https://nodejs.org (LTS) or with: brew install node"
  read -r -p "Press Enter to close…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install --omit=dev || { read -r -p "Install failed. Press Enter to close…"; exit 1; }
fi

node server.js
