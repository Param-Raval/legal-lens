/**
 * Integration test: the real /api/pdf-pages handler, from multipart request to
 * rendered JPEG pages, using an in-repo sample PDF. This exercises the whole
 * chain a PDF upload depends on — canvas globals, the pdfjs legacy build, the
 * worker fallback, the Node canvas factory, JPEG encoding, and the text-layer /
 * widget extraction — so any of those breaking fails here instead of in a
 * packaged installer.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/pdf-pages/route';

const SAMPLE_PDF = resolve(process.cwd(), 'sample_docs/i-589 filled.pdf');

function pdfRequest(bytes: Uint8Array, maxPages?: number): NextRequest {
  const form = new FormData();
  form.append(
    'file',
    new File([bytes as BlobPart], 'sample.pdf', { type: 'application/pdf' })
  );
  if (maxPages !== undefined) form.append('maxPages', String(maxPages));
  return new NextRequest('http://127.0.0.1/api/pdf-pages', {
    method: 'POST',
    body: form,
  });
}

// The sample PDF is gitignored (real form content) — skip rather than fail on a
// fresh clone that doesn't have it, but always run on dev machines and any CI
// that provisions sample_docs.
const withSample = existsSync(SAMPLE_PDF) ? describe : describe.skip;

withSample('/api/pdf-pages (real PDF end-to-end)', () => {
  it('renders pages to JPEGs with metadata', async () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE_PDF));
    const res = await POST(pdfRequest(bytes, 2));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      totalPagesInPdf: number;
      pages: Array<{
        pageNumber: number;
        jpeg: string;
        width: number;
        height: number;
      }>;
    };
    expect(body.totalPagesInPdf).toBeGreaterThan(0);
    expect(body.pages.length).toBeGreaterThan(0);
    expect(body.pages.length).toBeLessThanOrEqual(2);

    for (const page of body.pages) {
      expect(page.width).toBeGreaterThan(0);
      expect(page.height).toBeGreaterThan(0);
      // Base64 JPEG magic: /9j/ is 0xFFD8FF.
      expect(page.jpeg.startsWith('/9j/')).toBe(true);
      // A rendered page is never trivially small — a broken render path that
      // produced a blank canvas would still encode, but suspiciously tiny.
      expect(page.jpeg.length).toBeGreaterThan(5_000);
    }
  });

  it('respects the page cap and reports truncation', async () => {
    const bytes = new Uint8Array(readFileSync(SAMPLE_PDF));
    const res = await POST(pdfRequest(bytes, 1));
    const body = (await res.json()) as {
      truncated: boolean;
      totalPagesInPdf: number;
      pages: unknown[];
    };
    expect(body.pages.length).toBe(1);
    expect(body.truncated).toBe(body.totalPagesInPdf > 1);
  });
});

describe('/api/pdf-pages (validation)', () => {
  it('rejects a missing file with 400', async () => {
    const form = new FormData();
    const res = await POST(
      new NextRequest('http://127.0.0.1/api/pdf-pages', {
        method: 'POST',
        body: form,
      })
    );
    expect(res.status).toBe(400);
  });

  it('rejects a non-PDF file with 400', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' })
    );
    const res = await POST(
      new NextRequest('http://127.0.0.1/api/pdf-pages', {
        method: 'POST',
        body: form,
      })
    );
    expect(res.status).toBe(400);
  });

  it('returns a structured error (with reference) for corrupt PDF bytes', async () => {
    const garbage = new TextEncoder().encode('%PDF-1.7 this is not a real pdf');
    const res = await POST(pdfRequest(garbage));
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = (await res.json()) as { error: string; reference?: string };
    expect(body.error).toBeTruthy();
    // Whatever the failure, it must never be the old opaque catch-all.
    expect(body.error).not.toBe(
      'Something went wrong while processing this request. Please try again.'
    );
  });
});
