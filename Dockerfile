FROM node:20-bookworm AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json packages/backend/package.json
COPY packages/frontend/package.json packages/frontend/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter frontend build \
  && mkdir -p packages/backend/public \
  && cp -R packages/frontend/dist/. packages/backend/public/ \
  && pnpm --filter backend build \
  && pnpm --filter backend --prod deploy --legacy /opt/backend

FROM eclipse-temurin:17-jdk-jammy AS jdk

FROM curlimages/curl:8.12.1 AS downloader
ARG APKTOOL_VERSION=2.11.1
ARG APKTOOL_JAR_URL=https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar
ARG ANDROID_BUILD_TOOLS_URL=https://dl.google.com/android/repository/build-tools_r34-linux.zip
RUN mkdir -p /tmp/downloads \
  && curl -fsSL --retry 6 --retry-delay 2 --connect-timeout 20 "${APKTOOL_JAR_URL}" -o /tmp/downloads/apktool.jar \
  && curl -fsSL --retry 6 --retry-delay 2 --connect-timeout 20 "${ANDROID_BUILD_TOOLS_URL}" -o /tmp/downloads/build-tools.zip

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ARG ANDROID_BUILD_TOOLS_VERSION=34.0.0
COPY --from=jdk /opt/java/openjdk /opt/java/openjdk
COPY --from=downloader /tmp/downloads/apktool.jar /opt/apktool/apktool.jar
COPY --from=downloader /tmp/downloads/build-tools.zip /tmp/build-tools.zip

RUN set -eux; \
  mkdir -p /opt/android/build-tools/${ANDROID_BUILD_TOOLS_VERSION}; \
  cd /opt/android/build-tools/${ANDROID_BUILD_TOOLS_VERSION}; \
  /opt/java/openjdk/bin/jar xf /tmp/build-tools.zip; \
  rm -f /tmp/build-tools.zip; \
  tools_dir="$(dirname "$(find /opt/android/build-tools/${ANDROID_BUILD_TOOLS_VERSION} -type f -name apksigner | head -n1)")"; \
  test -n "${tools_dir}"; \
  test -f "${tools_dir}/zipalign"; \
  printf '%s\n' '#!/bin/sh' "exec ${tools_dir}/zipalign \"\$@\"" > /usr/local/bin/zipalign; \
  printf '%s\n' '#!/bin/sh' "exec ${tools_dir}/apksigner \"\$@\"" > /usr/local/bin/apksigner; \
  printf '%s\n' '#!/bin/sh' 'exec java -jar /opt/apktool/apktool.jar "$@"' > /usr/local/bin/apktool; \
  chmod +x /usr/local/bin/apktool /usr/local/bin/zipalign /usr/local/bin/apksigner \
    "${tools_dir}/zipalign" \
    "${tools_dir}/apksigner"

ENV APKTOOL_PATH=/usr/local/bin/apktool
ENV ZIPALIGN_PATH=/usr/local/bin/zipalign
ENV APKSIGNER_PATH=/usr/local/bin/apksigner
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH
ENV HOST=0.0.0.0

COPY --from=build /opt/backend /app

EXPOSE 3000
CMD ["node", "dist/index.js"]
