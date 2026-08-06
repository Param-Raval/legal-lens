/**
 * Registers the DOM globals pdfjs needs on `globalThis`. SERVER ONLY.
 *
 * WHY THIS EXISTS: pdf.mjs ships its own Node.js polyfill block that assigns
 * DOMMatrix, ImageData and Path2D from @napi-rs/canvas — but it is gated on
 * pdfjs's `isNodeJS`, defined as (pdf.mjs, ~line 6397):
 *
 *   !(process.versions.electron && process.type && process.type !== "browser")
 *
 * In the packaged desktop app the Next server runs inside Electron's
 * utilityProcess, where process.versions.electron is set and process.type is
 * "utility" — so isNodeJS is FALSE and pdfjs skips every one of its Node
 * polyfills. Under `next dev` the server is a plain Node process, isNodeJS is
 * true, pdfjs polyfills itself, and everything works. That is exactly why PDF
 * upload worked in development but failed in the installed .exe with
 * "ReferenceError: Path2D is not defined" thrown from
 * CanvasGraphics.constructPath at render time (regression of Aug 2026; the fix
 * from commit 0590277 was partially lost in 5e0c915, which switched DOMMatrix to
 * the geometry.js polyfill but dropped the Path2D/ImageData assignments).
 *
 * So this module supplies ALL of them, unconditionally, and MUST be awaited
 * before pdfjs is imported: pdfjs evaluates `new DOMMatrix()` at module level.
 *
 * Kept as its own module (not inline in the route) so a unit test can wipe the
 * globals and assert every one of them comes back — the regression test for the
 * exact failure above.
 */
import { log } from './logger';

/** The globals pdfjs requires to parse and render in Node. */
export const REQUIRED_CANVAS_GLOBALS = [
  'DOMMatrix',
  'DOMPoint',
  'DOMRect',
  'Path2D',
  'ImageData',
] as const;

export interface CanvasRuntime {
  /** @napi-rs/canvas's createCanvas, for the page-render canvas factory. */
  createCanvas: (width: number, height: number) => unknown;
}

/**
 * Ensure every global in REQUIRED_CANVAS_GLOBALS (plus a minimal `navigator`)
 * exists on globalThis, and return the canvas runtime the route renders with.
 *
 * Throws a plain-language error naming the missing globals if the canvas
 * library cannot provide them — far better than the opaque ReferenceError pdfjs
 * would otherwise throw from the middle of a page render.
 */
export async function ensureCanvasGlobals(): Promise<CanvasRuntime> {
  const g = globalThis as Record<string, unknown>;

  // Step 1: geometry types from @napi-rs/canvas/geometry.js — a vendored pure-JS
  // polyfill with no native binary dependency, and traced into the Vercel
  // function bundle even where the native addon isn't. NOTE: geometry.js exports
  // only DOMPoint/DOMMatrix/DOMRect — Path2D and ImageData are not in it, which
  // is why step 2 must also assign globals.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const geom = require('@napi-rs/canvas/geometry.js') as Record<
      string,
      unknown
    >;
    if (!g.DOMMatrix) g.DOMMatrix = geom.DOMMatrix;
    if (!g.DOMPoint) g.DOMPoint = geom.DOMPoint;
    if (!g.DOMRect) g.DOMRect = geom.DOMRect;
  } catch {
    // Native package provides the same classes in step 2; only fatal if both fail.
  }

  // Step 2: the native canvas package — createCanvas for rendering, plus the
  // Path2D / ImageData (and DOMMatrix, as a fallback) classes. Needs a
  // platform-specific .node binary: bundled for Electron by
  // prepare-standalone.mjs, installed for Vercel Linux via `current` arch in
  // pnpm-workspace.yaml supportedArchitectures.
  const canvas = (await import('@napi-rs/canvas')) as unknown as Record<
    string,
    unknown
  >;

  // Path2D and ImageData are used DURING rendering (constructPath, image ops),
  // so unlike DOMMatrix they don't fail at import time — they fail per page.
  // That is why the original regression went unnoticed until a real PDF was
  // rendered in the packaged app.
  for (const key of REQUIRED_CANVAS_GLOBALS) {
    if (!g[key] && canvas[key]) g[key] = canvas[key];
  }

  // pdfjs reads navigator.language/platform/userAgent while rendering; its own
  // shim is behind the same isNodeJS gate as the class polyfills.
  if (!g.navigator) {
    g.navigator = { language: 'en-US', platform: '', userAgent: '' };
  }

  const missing = REQUIRED_CANVAS_GLOBALS.filter(k => !g[k]);
  if (missing.length > 0) {
    log.error('pdf-canvas-globals', 'canvas globals missing — cannot render PDFs', {
      missing,
      canvasHasCreateCanvas: typeof canvas.createCanvas === 'function',
      processType: (process as NodeJS.Process & { type?: string }).type ?? null,
      electron: process.versions.electron ?? null,
    });
    throw new Error(
      `PDF rendering is unavailable: the canvas library did not provide ${missing.join(', ')}.`
    );
  }

  return {
    createCanvas: canvas.createCanvas as CanvasRuntime['createCanvas'],
  };
}
