/**
 * Regression test for the packaged-app PDF failure of Aug 2026:
 * "ReferenceError: Path2D is not defined" from CanvasGraphics.constructPath.
 *
 * Inside Electron's utilityProcess pdfjs disables its own Node polyfills
 * (its isNodeJS check sees process.versions.electron + process.type), so the
 * app must register DOMMatrix/DOMPoint/DOMRect/Path2D/ImageData itself before
 * importing pdfjs. An earlier fix did exactly that, then a later commit
 * (5e0c915) rewrote the block and silently dropped Path2D/ImageData — dev kept
 * working (plain Node lets pdfjs self-polyfill) and only the installer broke.
 *
 * This test wipes the globals and requires ensureCanvasGlobals() to restore
 * every one of them, so dropping any assignment again fails CI instead of
 * shipping.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureCanvasGlobals,
  REQUIRED_CANVAS_GLOBALS,
} from '@/lib/pdf-canvas-globals';

const g = globalThis as Record<string, unknown>;
let saved: Record<string, unknown>;

beforeEach(() => {
  saved = {};
  for (const key of [...REQUIRED_CANVAS_GLOBALS, 'navigator']) {
    saved[key] = g[key];
    delete g[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete g[key];
    else g[key] = value;
  }
});

describe('ensureCanvasGlobals', () => {
  it('registers every global pdfjs needs, from a clean slate', async () => {
    for (const key of REQUIRED_CANVAS_GLOBALS) {
      expect(g[key], `${key} should start absent`).toBeUndefined();
    }

    await ensureCanvasGlobals();

    for (const key of REQUIRED_CANVAS_GLOBALS) {
      expect(typeof g[key], `${key} must be registered`).toBe('function');
    }
  });

  it('explicitly covers Path2D and ImageData — the ones the regression dropped', async () => {
    await ensureCanvasGlobals();
    // Constructible, not just present: pdfjs does `new Path2D()` per drawn path.
    expect(() => new (g.Path2D as new () => unknown)()).not.toThrow();
    expect(
      () => new (g.ImageData as new (w: number, h: number) => unknown)(2, 2)
    ).not.toThrow();
  });

  it('provides a navigator shim (pdfjs reads navigator.language in rendering)', async () => {
    await ensureCanvasGlobals();
    expect(
      (g.navigator as { language?: string } | undefined)?.language
    ).toBeTruthy();
  });

  it('returns a working createCanvas', async () => {
    const { createCanvas } = await ensureCanvasGlobals();
    const canvas = createCanvas(4, 4) as {
      getContext: (kind: string) => unknown;
    };
    expect(canvas.getContext('2d')).toBeTruthy();
  });

  it('does not clobber globals that already exist', async () => {
    class Sentinel {}
    g.Path2D = Sentinel;
    await ensureCanvasGlobals();
    expect(g.Path2D).toBe(Sentinel);
  });
});
