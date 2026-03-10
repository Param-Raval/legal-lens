import { NextRequest, NextResponse } from 'next/server';
import { resolve } from 'path';

// Allow up to 30s for multi-page PDF rendering
export const maxDuration = 30;

const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

const MAX_PAGES = 10;
const RENDER_SCALE = 1.5;
const JPEG_QUALITY = 0.85;

export async function POST(request: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: 'Request must be multipart/form-data' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    const file = formData.get('file') as File | null;
    const maxPagesParam = formData.get('maxPages');
    const maxPages = maxPagesParam
      ? Math.min(parseInt(maxPagesParam as string, 10), MAX_PAGES)
      : MAX_PAGES;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json(
        { error: 'Only PDF files are accepted' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    // ── Load pdfjs-dist legacy build (Node.js compatible) ───────────────
    const workerPath = resolve(
      process.cwd(),
      'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
    );

    // Dynamically import to keep out of the client bundle
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'file:///' + workerPath.replace(/\\/g, '/')
    ).toString();

    const buf = await file.arrayBuffer();

    // Suppress pdfjs font warnings that don't affect rendering.
    // Wrapped in try/finally so console.warn is always restored.
    const origWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      const msg = String(args[0] ?? '');
      if (!msg.includes('standardFontDataUrl') && !msg.includes('UnknownErrorException')) {
        origWarn(...args);
      }
    };

    try {
      let pdf;
      try {
        pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      } catch (err: unknown) {
        const name =
          err && typeof err === 'object' && 'name' in err
            ? (err as { name: string }).name
            : '';
        if (name === 'PasswordException') {
          return NextResponse.json(
            {
              error: `"${file.name}" is password-protected. Please provide an unprotected PDF.`,
            },
            { status: 422, headers: PRIVACY_HEADERS }
          );
        }
        return NextResponse.json(
          {
            error: `Could not read "${file.name}". The file may be corrupt or not a valid PDF.`,
          },
          { status: 422, headers: PRIVACY_HEADERS }
        );
      }

      const totalPagesInPdf = pdf.numPages;
      const pagesToExtract = Math.min(totalPagesInPdf, maxPages);

      // ── Load @napi-rs/canvas for server-side rendering ─────────────────
      const { createCanvas } = await import('@napi-rs/canvas');

      const pages: Array<{
        pageNumber: number;
        jpeg: string; // base64-encoded JPEG
        width: number;
        height: number;
      }> = [];

      for (let i = 1; i <= pagesToExtract; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: RENDER_SCALE });

        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        // @napi-rs/canvas returns a canvas compatible with pdfjs's Node.js canvas API
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const canvas = createCanvas(width, height) as any;
        const ctx = canvas.getContext('2d');

        await page.render({
          canvasContext: ctx,
          viewport,
          canvas: canvas as unknown as HTMLCanvasElement,
        }).promise;

        // Export as JPEG buffer then base64-encode
        const jpegBuffer: Buffer = canvas.toBuffer('image/jpeg', { quality: JPEG_QUALITY });
        pages.push({
          pageNumber: i,
          jpeg: jpegBuffer.toString('base64'),
          width,
          height,
        });
      }

      return NextResponse.json(
        {
          totalPagesInPdf,
          pagesToExtract,
          truncated: totalPagesInPdf > pagesToExtract,
          pages,
        },
        { headers: PRIVACY_HEADERS }
      );
    } finally {
      console.warn = origWarn;
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'PDF processing failed';
    return NextResponse.json(
      { error: message },
      { status: 500, headers: PRIVACY_HEADERS }
    );
  }
}
