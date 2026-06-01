import { NextRequest, NextResponse } from 'next/server';
import { resolve } from 'path';
import {
  enforceBodySize,
  safeErrorResponse,
  MAX_UPLOAD_BYTES,
} from '@/lib/api-guard';

// Allow up to 30s for multi-page PDF rendering
export const maxDuration = 30;

const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

const MAX_PAGES = 10;
const RENDER_SCALE = 1.5;
const JPEG_QUALITY = 0.85;
/**
 * Minimum non-whitespace characters in a page's text layer for us to treat it
 * as born-digital and structure it from text instead of vision-OCR. Scanned
 * pages have no text layer (≈0 chars) and fall through to image OCR unchanged.
 */
const MIN_TEXT_LAYER_CHARS = 100;

/**
 * A PDF can carry a text layer that is present but CORRUPT (broken ToUnicode/CMap
 * producing mojibake, or glyphs that don't match the rendered page). A pure length
 * check would treat that garbage as born-digital text and trust it, skipping the
 * vision-OCR fallback that would have read the real page. This rejects a populated-
 * but-low-quality layer so the page falls back to image OCR (the safe direction).
 */
function isUsableTextLayer(raw: string): boolean {
  const compact = raw.replace(/\s/g, '');
  const total = compact.length;
  if (total < MIN_TEXT_LAYER_CHARS) return false;
  const replacement = (compact.match(/�/g) ?? []).length;
  // C0/C1 control chars (tab/newline already stripped as whitespace) signal broken encoding.
  let controls = 0;
  for (let i = 0; i < compact.length; i++) {
    const c = compact.charCodeAt(i);
    if (
      (c >= 0 && c <= 8) ||
      c === 11 ||
      c === 12 ||
      (c >= 14 && c <= 31) ||
      (c >= 127 && c <= 159)
    ) {
      controls++;
    }
  }
  const lettersAndDigits =
    (compact.match(/\p{L}/gu) ?? []).length +
    (compact.match(/\p{N}/gu) ?? []).length;
  if (replacement / total > 0.05) return false; // undecodable glyphs
  if (controls / total > 0.02) return false; // broken encoding
  if (lettersAndDigits / total < 0.4) return false; // mostly symbols → not real text
  return true;
}

export async function POST(request: NextRequest) {
  try {
    const tooLarge = enforceBodySize(
      request,
      MAX_UPLOAD_BYTES,
      PRIVACY_HEADERS
    );
    if (tooLarge) return tooLarge;

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

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `File too large. Maximum allowed is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 413, headers: PRIVACY_HEADERS }
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
      if (
        !msg.includes('standardFontDataUrl') &&
        !msg.includes('UnknownErrorException')
      ) {
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
        /** Exact text-layer content if this is a born-digital page, else ''. */
        text: string;
      }> = [];

      for (let i = 1; i <= pagesToExtract; i++) {
        const page = await pdf.getPage(i);

        // Pull the digital text layer (free, exact). pdfjs returns text items
        // with `str`; `hasEOL` marks line breaks. Marked-content items have no
        // `str` and are skipped. Scanned pages yield ≈nothing → image OCR.
        let textLayer = '';
        try {
          const tc = await page.getTextContent();
          textLayer = tc.items
            .map(it =>
              'str' in it
                ? it.str + ((it as { hasEOL?: boolean }).hasEOL ? '\n' : ' ')
                : ''
            )
            .join('')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
        } catch {
          textLayer = '';
        }
        const hasTextLayer = isUsableTextLayer(textLayer);

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
        const jpegBuffer: Buffer = canvas.toBuffer('image/jpeg', {
          quality: JPEG_QUALITY,
        });
        pages.push({
          pageNumber: i,
          jpeg: jpegBuffer.toString('base64'),
          width,
          height,
          text: hasTextLayer ? textLayer : '',
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
    return safeErrorResponse(error, PRIVACY_HEADERS);
  }
}
