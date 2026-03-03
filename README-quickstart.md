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
APKTOOL_JAR_URL=https://ghproxy.com/https://github.com/iBotPeaches/Apktool/releases/download/v2.11.1/apktool_2.11.1.jar
ANDROID_BUILD_TOOLS_URL=https://dl.google.com/android/repository/build-tools_r34-linux.zip
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
