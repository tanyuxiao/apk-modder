# APK Modder Quick Start

## Prerequisite
- Docker Desktop is installed and running.

## Start
```bash
docker compose up -d
```

Open: [http://localhost:3000](http://localhost:3000)

## Optional: mirror overrides (for restricted networks)
```bash
cat > .env <<'EOF'
NODE_BUILD_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-bookworm
NODE_RUNTIME_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-bookworm-slim
APKTOOL_JAR_URL=https://ghproxy.com/https://github.com/iBotPeaches/Apktool/releases/download/v2.11.1/apktool_2.11.1.jar
ANDROID_BUILD_TOOLS_URL=https://dl.google.com/android/repository/build-tools_r34-linux.zip
JRE_URL_AMD64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jre/hotspot/normal/eclipse
JRE_URL_ARM64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/aarch64/jre/hotspot/normal/eclipse
EOF
docker compose up -d --build
```

## Stop
```bash
docker compose down
```

## Optional: Reset local service data
```bash
docker compose down -v
```
