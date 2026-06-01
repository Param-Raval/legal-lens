/**
 * Post-build script: assembles the Next.js standalone directory for Electron
 * packaging by copying static assets and native modules that the standalone
 * output does not include automatically, then renaming node_modules ->
 * server_modules and emitting a start.js shim (see step 6 for why).
 */
import {
  cpSync,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

const root = process.cwd();
const standaloneDir = join(root, '.next', 'standalone');

if (!existsSync(standaloneDir)) {
  console.log('No standalone directory found — skipping prepare-standalone.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Transient-lock resilience.
// Windows Defender (and file-sync clients) briefly lock freshly-written native
// binaries — notably @napi-rs/canvas's *.node addon — while scanning them. That
// surfaces as EPERM/EBUSY/EPIPE/EACCES sharing violations during copy/rename.
// Retry these transient failures with a short backoff instead of crashing.
// ---------------------------------------------------------------------------
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EPIPE', 'EACCES', 'ENOTEMPTY']);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withRetry(label, fn, attempts = 12, delayMs = 500) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (err) {
      if (!TRANSIENT.has(err.code) || i >= attempts) throw err;
      console.warn(
        `  ${label}: transient ${err.code}, retry ${i}/${attempts - 1} in ${delayMs}ms`,
      );
      sleepSync(delayMs);
    }
  }
}

function cpRetry(src, dest) {
  withRetry(`copy ${dest}`, () => {
    // Next's file-trace may have already placed a junction/symlink at `dest`
    // that points back to the same pnpm store entry as `src` (which would make
    // cpSync throw "src and dest cannot be the same"). Remove it first, then
    // copy with dereference:true so the bundle gets REAL files, not symlinks
    // (symlinks into the pnpm store do not survive packaging).
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true, force: true, dereference: true });
  });
}

// 1. Copy .next/static → standalone/.next/static (client JS/CSS/fonts)
const staticSrc = join(root, '.next', 'static');
const staticDest = join(standaloneDir, '.next', 'static');
if (existsSync(staticSrc)) {
  cpRetry(staticSrc, staticDest);
  console.log('Copied .next/static');
}

// 2. Copy public/ → standalone/public/ (static assets)
const publicSrc = join(root, 'public');
const publicDest = join(standaloneDir, 'public');
if (existsSync(publicSrc)) {
  cpRetry(publicSrc, publicDest);
  console.log('Copied public/');
}

// 3. Copy native / external modules that serverExternalPackages excludes
//    from the webpack bundle — they must be present at runtime.
//    NOTE: copy the @napi-rs/canvas WRAPPER only (not the whole @napi-rs scope),
//    so cross-platform canvas-*-binary packages that supportedArchitectures
//    installs don't leak into this OS's bundle. Step 4 adds the binary packages
//    matching the build OS.
const externalPackages = ['@napi-rs/canvas', 'pdfjs-dist'];

for (const pkg of externalPackages) {
  const src = join(root, 'node_modules', pkg);
  const dest = join(standaloneDir, 'node_modules', pkg);
  if (existsSync(src)) {
    cpRetry(src, dest);
    console.log(`Copied node_modules/${pkg}`);
  } else {
    console.warn(`Warning: node_modules/${pkg} not found — skipping`);
  }
}

// 4. Copy the @napi-rs/canvas prebuilt binary packages for the BUILD OS only.
//    supportedArchitectures (pnpm-workspace.yaml) installs canvas-* for several
//    os/arch combos so the dual-arch macOS dmg has both binaries; we bundle the
//    ones matching this OS (both arches for that OS), and skip the others so a
//    Windows .exe doesn't ship darwin binaries (and vice versa).
const canvasPlatformPrefix =
  process.platform === 'win32'
    ? 'canvas-win32-'
    : process.platform === 'darwin'
      ? 'canvas-darwin-'
      : process.platform === 'linux'
        ? 'canvas-linux-'
        : 'canvas-';
// First prune any cross-OS canvas-* binary packages that Next's file trace
// already copied into the standalone — with supportedArchitectures installing
// every arch, the trace pulls them all in, which would bloat each OS's bundle
// with the others' binaries (~15 MB each).
const standaloneNapirDir = join(standaloneDir, 'node_modules', '@napi-rs');
if (existsSync(standaloneNapirDir)) {
  for (const entry of readdirSync(standaloneNapirDir)) {
    if (entry.startsWith('canvas-') && !entry.startsWith(canvasPlatformPrefix)) {
      withRetry(`prune @napi-rs/${entry}`, () =>
        rmSync(join(standaloneNapirDir, entry), { recursive: true, force: true }),
      );
      console.log(`Pruned cross-OS node_modules/@napi-rs/${entry}`);
    }
  }
}

const napirsDir = join(root, 'node_modules', '@napi-rs');
if (existsSync(napirsDir)) {
  for (const entry of readdirSync(napirsDir)) {
    if (!entry.startsWith(canvasPlatformPrefix)) continue;
    const src = join(napirsDir, entry);
    const dest = join(standaloneDir, 'node_modules', '@napi-rs', entry);
    if (existsSync(src)) {
      cpRetry(src, dest);
      console.log(`Copied node_modules/@napi-rs/${entry}`);
    }
  }
}

// 5. Remove .env from standalone — Next.js copies the project .env which may
//    contain real API keys. The Electron main process loads env vars from the
//    user's AppData directory instead.
const envInStandalone = join(standaloneDir, '.env');
if (existsSync(envInStandalone)) {
  unlinkSync(envInStandalone);
  console.log('Removed .env from standalone (security: avoid bundling secrets)');
}

// Also remove .env.local if present.
const envLocalInStandalone = join(standaloneDir, '.env.local');
if (existsSync(envLocalInStandalone)) {
  unlinkSync(envLocalInStandalone);
  console.log('Removed .env.local from standalone');
}

// 6. Rename node_modules -> server_modules and emit a start.js shim.
//    electron-builder / asar do not reliably ship a *nested* node_modules that
//    lives inside extraResources, so we ship the deps under a neutral name and
//    re-add that folder to Node's module search path at runtime via start.js.
//    NOTE: require()'s normal node_modules walk will never find these, so the
//    shim MUST set NODE_PATH and call Module._initPaths(). (Module.globalPaths
//    .push() does NOT affect resolution in modern Node — it is a silent no-op.)
const nodeModulesDir = join(standaloneDir, 'node_modules');
const serverModulesDir = join(standaloneDir, 'server_modules');

if (existsSync(serverModulesDir)) {
  withRetry('rm old server_modules', () =>
    rmSync(serverModulesDir, { recursive: true, force: true }),
  );
}
if (existsSync(nodeModulesDir)) {
  withRetry('rename node_modules -> server_modules', () =>
    renameSync(nodeModulesDir, serverModulesDir),
  );
  console.log('Renamed node_modules -> server_modules');
} else if (!existsSync(serverModulesDir)) {
  console.warn('Warning: no node_modules in standalone to rename');
}

const startJs = `'use strict';
const path = require('path');
const Module = require('module');

// Next.js standalone dependencies are shipped under ./server_modules instead of
// ./node_modules (see scripts/prepare-standalone.mjs). Re-add that directory to
// Node's global module search path so require('next') and its transitive deps
// resolve at runtime.
process.env.NODE_PATH =
  path.join(__dirname, 'server_modules') +
  (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
Module._initPaths();

require('./server.js');
`;
writeFileSync(join(standaloneDir, 'start.js'), startJs);
console.log('Wrote start.js shim (NODE_PATH + Module._initPaths)');

console.log('Standalone directory prepared for Electron packaging.');
