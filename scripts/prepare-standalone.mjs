/**
 * Post-build script: assembles the Next.js standalone directory for Electron
 * packaging by copying static assets and native modules that the standalone
 * output does not include automatically.
 */
import { cpSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const standaloneDir = join(root, '.next', 'standalone');

if (!existsSync(standaloneDir)) {
  console.log('No standalone directory found — skipping prepare-standalone.');
  process.exit(0);
}

// 1. Copy .next/static → standalone/.next/static (client JS/CSS/fonts)
const staticSrc = join(root, '.next', 'static');
const staticDest = join(standaloneDir, '.next', 'static');
if (existsSync(staticSrc)) {
  cpSync(staticSrc, staticDest, { recursive: true });
  console.log('Copied .next/static');
}

// 2. Copy public/ → standalone/public/ (static assets)
const publicSrc = join(root, 'public');
const publicDest = join(standaloneDir, 'public');
if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDest, { recursive: true });
  console.log('Copied public/');
}

// 3. Copy native / external modules that serverExternalPackages excludes
//    from the webpack bundle — they must be present at runtime.
const externalPackages = ['@napi-rs', 'pdfjs-dist'];

for (const pkg of externalPackages) {
  const src = join(root, 'node_modules', pkg);
  const dest = join(standaloneDir, 'node_modules', pkg);
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
    console.log(`Copied node_modules/${pkg}`);
  } else {
    console.warn(`Warning: node_modules/${pkg} not found — skipping`);
  }
}

// 4. Copy platform-specific @napi-rs/canvas binary packages.
//    Rather than hard-coding a list, discover whatever canvas-* packages
//    are installed (npm ci / npm install puts only the current platform's
//    optional deps on disk, plus any manually installed extras).
const napirsDir = join(root, 'node_modules', '@napi-rs');
if (existsSync(napirsDir)) {
  for (const entry of readdirSync(napirsDir)) {
    if (!entry.startsWith('canvas-')) continue;
    const src = join(napirsDir, entry);
    const dest = join(standaloneDir, 'node_modules', '@napi-rs', entry);
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true });
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

console.log('Standalone directory prepared for Electron packaging.');
