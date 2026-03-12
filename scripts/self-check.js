#!/usr/bin/env node
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const Redis = require('ioredis');

function withPath(cmd, envKey) {
  const custom = process.env[envKey];
  if (!custom) return cmd;
  const trimmed = String(custom).trim();
  if (!trimmed) return cmd;
  return `${trimmed} ${cmd.split(' ').slice(1).join(' ')}`.trim();
}

const checks = [
  { name: 'apktool', cmd: withPath('apktool -version', 'APKTOOL_PATH') },
  { name: 'zipalign', cmd: withPath('zipalign -h', 'ZIPALIGN_PATH') },
  { name: 'apksigner', cmd: withPath('apksigner --version', 'APKSIGNER_PATH') },
  { name: 'keytool', cmd: withPath('keytool -help', 'KEYTOOL_PATH') },
];

function resolveBinary(cmd) {
  const bin = cmd.trim().split(/\s+/)[0];
  if (bin.includes('/') && fs.existsSync(bin)) return bin;
  try {
    const resolved = execSync(`which ${bin}`, { stdio: 'pipe' }).toString().trim();
    return resolved || null;
  } catch {
    return null;
  }
}

async function run() {
  console.log('[self-check] Toolchain');
  let failed = false;
  for (const item of checks) {
    const binPath = resolveBinary(item.cmd);
    if (!binPath) {
      failed = true;
      console.log(`  ✗ ${item.name}`);
      console.log('    binary not found');
      continue;
    }
    console.log(`  ✓ ${item.name} (${binPath})`);
  }

  const host = process.env.REDIS_HOST || '127.0.0.1';
  const port = Number(process.env.REDIS_PORT || 6379);
  console.log('[self-check] Redis');
  try {
    const redis = new Redis({ host, port, lazyConnect: true });
    redis.on('error', () => {});
    await redis.connect();
    const pong = await redis.ping();
    console.log(`  ✓ Redis ${host}:${port} -> ${pong}`);
    await redis.quit();
  } catch (err) {
    failed = true;
    console.log(`  ✗ Redis ${host}:${port}`);
    console.log(`    ${String(err && err.message ? err.message : err).split('\n')[0]}`);
  }

  if (failed) {
    process.exit(1);
  }
}

run();
