/**
 * Verifies PDF rendering runtime prerequisites for desktop packaging.
 *
 * We rely on pdfjs-dist + @napi-rs/canvas in Node.js for /api/pdf-pages.
 * If canvas globals or pdfjs files are missing, EXE/DMG builds can succeed
 * but PDF uploads fail at runtime. This script fails fast in CI/build scripts.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';

function requireFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing required file: ${path}`);
  }
}

async function main() {
  const canvas = await import('@napi-rs/canvas');
  const missingExports = [
    'createCanvas',
    'DOMMatrix',
    'ImageData',
    'Path2D',
  ].filter(k => !(k in canvas) || !canvas[k]);

  if (missingExports.length) {
    throw new Error(
      `@napi-rs/canvas is missing exports: ${missingExports.join(', ')}`
    );
  }

  requireFile(resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  requireFile(resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'));

  console.log('[pdf-runtime-check] OK: canvas exports + pdfjs files present');
}

main().catch(err => {
  console.error('[pdf-runtime-check] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
