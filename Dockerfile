ARG NODE_BUILD_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-bookworm
ARG NODE_RUNTIME_IMAGE=swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/library/node:20-bookworm-slim

FROM ${NODE_BUILD_IMAGE} AS build
WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

ARG APKTOOL_VERSION=2.11.1
ARG APKTOOL_JAR_URL=https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar
ARG ANDROID_BUILD_TOOLS_URL=https://dl.google.com/android/repository/build-tools_r34-linux.zip
ARG JRE_URL_AMD64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jre/hotspot/normal/eclipse
ARG JRE_URL_ARM64=https://api.adoptium.net/v3/binary/latest/17/ga/linux/aarch64/jre/hotspot/normal/eclipse
ARG TARGETARCH

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

RUN set -eux; \
  case "${TARGETARCH}" in \
    amd64) jre_url="${JRE_URL_AMD64}" ;; \
    arm64) jre_url="${JRE_URL_ARM64}" ;; \
    *) echo "Unsupported TARGETARCH: ${TARGETARCH}"; exit 1 ;; \
  esac; \
  mkdir -p /opt/tooling; \
  curl -fsSL --retry 6 --retry-delay 2 --connect-timeout 20 "${APKTOOL_JAR_URL}" -o /opt/tooling/apktool.jar; \
  curl -fsSL --retry 6 --retry-delay 2 --connect-timeout 20 "${ANDROID_BUILD_TOOLS_URL}" -o /opt/tooling/build-tools.zip; \
  curl -fsSL --retry 6 --retry-delay 2 --connect-timeout 20 "${jre_url}" -o /opt/tooling/jre.tar.gz

FROM ${NODE_RUNTIME_IMAGE} AS runtime
WORKDIR /app

ARG ANDROID_BUILD_TOOLS_VERSION=34.0.0
COPY --from=build /opt/tooling/apktool.jar /opt/apktool/apktool.jar
COPY --from=build /opt/tooling/build-tools.zip /tmp/build-tools.zip
COPY --from=build /opt/tooling/jre.tar.gz /tmp/jre.tar.gz

RUN set -eux; \
  mkdir -p /opt/java/openjdk; \
  tar -xzf /tmp/jre.tar.gz -C /opt/java/openjdk --strip-components=1; \
  rm -f /tmp/jre.tar.gz; \
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
