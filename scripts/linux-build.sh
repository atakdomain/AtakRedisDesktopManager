#!/usr/bin/env bash
# Linux derlemesi (WSL, root): kaynağı Linux dosya sistemine kopyalar, denetler ve paketler.
#   wsl -d aWork-build -u root -- bash /mnt/e/Github/AtakRedisDesktopManager/scripts/linux-build.sh [check|bundle]
# Ön koşul: /opt/node-*, /root/.cargo ve Tauri'nin apt bağımlılıkları (E:/DevTools/awork-linux-setup.sh kurar).
set -euo pipefail
MODE="${1:-check}"
export PATH="/root/.bun/bin:/root/.cargo/bin:$(ls -d /opt/node-*/bin | head -1):$PATH"
export APPIMAGE_EXTRACT_AND_RUN=1

if ! command -v bun >/dev/null; then
  curl -fsSL https://bun.sh/install | bash >/dev/null
fi

SRC=/mnt/e/Github/AtakRedisDesktopManager
B=/root/build/AtakRedisDesktopManager
mkdir -p "$B"
rsync -a --delete --exclude node_modules --exclude dist --exclude src-tauri/target --exclude .git "$SRC/" "$B/"
cd "$B"
bun install --frozen-lockfile

if [ "$MODE" = "bundle" ]; then
  bun tauri build --bundles appimage,deb,rpm
  OUT="$SRC/src-tauri/target/linux-bundle"
  mkdir -p "$OUT"
  cp -f src-tauri/target/release/bundle/appimage/*.AppImage src-tauri/target/release/bundle/deb/*.deb src-tauri/target/release/bundle/rpm/*.rpm "$OUT/"
  ls -la "$OUT"
else
  bun run check
  bun run test
  cargo build --manifest-path src-tauri/Cargo.toml
  cargo test --manifest-path src-tauri/Cargo.toml
fi
