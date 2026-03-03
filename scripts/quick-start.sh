#!/usr/bin/env bash
set -euo pipefail

IMAGE="${APK_MODDER_IMAGE:-ghcr.io/tanyuxiao/apk-modder:latest}"
export APK_MODDER_PLATFORM="${APK_MODDER_PLATFORM:-linux/amd64}"

echo "[quick-start] Trying prebuilt image: ${IMAGE}"
if docker pull "${IMAGE}" >/dev/null 2>&1; then
  echo "[quick-start] Prebuilt image is available, starting from image (platform=${APK_MODDER_PLATFORM})."
  docker compose -f docker-compose.yml -f docker-compose.prebuilt.yml up -d
else
  echo "[quick-start] Prebuilt image not accessible, falling back to local build (platform=${APK_MODDER_PLATFORM})."
  docker compose up -d --build
fi

echo "[quick-start] Done. Open: http://localhost:3000"
