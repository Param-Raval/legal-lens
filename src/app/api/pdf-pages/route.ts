import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import {
  enforceBodySize,
  safeErrorResponse,
  withApiLogging,
  MAX_UPLOAD_BYTES,
} from '@/lib/api-guard';
import { ensureCanvasGlobals } from '@/lib/pdf-canvas-globals';

// Allow up to 60s for multi-page PDF rendering (25 pages at 1.5x scale needs room).
export const maxDuration = 60;

const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

/**
 * Maximum pages extracted per PDF.
 * Must stay in sync with MAX_PAGES in src/lib/pdf-extract.ts.
 */
const MAX_PAGES = 25;
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

/**
 * Derive a readable label from an XFA/AcroForm field name like
 * "form1[0].#subform[0].PtAILine4_LastName[0]" → "LastName". Returns '' for
 * generic auto-names (TextField3, Cell1) where only the value carries signal.
 */
function cleanFieldLabel(fieldName: string): string {
  let s = (fieldName.split('.').pop() ?? '').replace(/\[\d+\]$/, '');
  s = s.replace(/^Pt[A-Z]+Line\d+_?/i, ''); // strip "PtAIILine5_" section prefixes
  if (/^(TextField|Cell|Table|Subform|RadioButtonList|CheckBox\w*|p\d|f\d)\d*$/i.test(s))
    return '';
  return s.replace(/_/g, ' ').trim();
}

/**
 * Pull filled AcroForm/XFA widget values from a page as readable "Label: value"
 * lines. These carry the applicant's typed answers, which getTextContent() does
 * NOT return (the content stream holds only the blank template). Skips empty/Off
 * checkboxes and the form's PDF417 barcodes. Deduplicated, order-preserved.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractWidgetLines(annotations: any[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const a of annotations) {
    const raw = a?.fieldValue;
    const value = (Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!value || value === 'Off') continue;
    const name = String(a?.fieldName ?? '');
    if (/barcode/i.test(name) || /^I-\d+\|/.test(value)) continue; // form barcodes
    const label = cleanFieldLabel(name);
    const line = label ? `${label}: ${value}` : value;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

async function handlePost(request: NextRequest) {
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

    // ── Register the DOM globals pdfjs needs BEFORE importing pdfjs ────────
    // pdfjs's own Node polyfills (Path2D/ImageData/DOMMatrix) are disabled inside
    // Electron's utilityProcess — the packaged app's exact environment — so they
    // must all be supplied here. Full story and the regression it guards against:
    // src/lib/pdf-canvas-globals.ts. MUST be awaited before the pdfjs import
    // below, because pdf.mjs evaluates `new DOMMatrix()` at module level.
    const { createCanvas } = await ensureCanvasGlobals();

    // ── Load pdfjs-dist legacy build (Node.js compatible) ───────────────
    const _pdfjsWorkerCandidates = [
      resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
      resolve(process.cwd(), 'server_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ];
    const _pdfjsWorkerAbsolute = _pdfjsWorkerCandidates.find(p => existsSync(p));

    // ESM import() does NOT respect NODE_PATH (unlike CJS require). The Electron
    // packaged app renames node_modules → server_modules; start.js sets
    // NODE_PATH=server_modules which fixes CJS require('next') etc., but a bare
    // specifier in an ESM import() fails because the ESM resolver only walks
    // node_modules directories. Probe both locations and use an absolute file://
    // URL — ESM loads the file directly, no package resolution needed.
    // /* webpackIgnore: true */ prevents webpack re-externalizing back to bare specifier.
    const _pdfjsMjsCandidates = [
      resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'),
      resolve(process.cwd(), 'server_modules/pdfjs-dist/legacy/build/pdf.mjs'),
    ];
    const _pdfjsMjsAbsolute = _pdfjsMjsCandidates.find(p => existsSync(p));
    const pdfjsLib = _pdfjsMjsAbsolute
      ? await import(/* webpackIgnore: true */ pathToFileURL(_pdfjsMjsAbsolute).href as string)
      : await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (_pdfjsWorkerAbsolute) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'file:///' + _pdfjsWorkerAbsolute.replace(/\\/g, '/')
      ).toString();
    }

    // pdfjs detects Electron (process.versions.electron is set) and treats it as
    // NOT Node.js, so `isNodeJS` is false and pdfjs falls back to DOMCanvasFactory
    // which calls document.createElement('canvas') — crashing because there is no
    // DOM. We override this by passing a CanvasFactory CLASS (capital C, not an
    // instance) to getDocument — pdfjs calls `new CanvasFactory({ownerDocument})`
    // so the constructor must accept and ignore those kwargs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _cc = createCanvas as (w: number, h: number) => any;
    class NodeCanvasFactory {
      // pdfjs passes {ownerDocument} — accepted and deliberately ignored.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      constructor(_opts?: any) {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create(width: number, height: number): { canvas: any; context: any } {
        const canvas = _cc(width, height);
        return { canvas, context: canvas.getContext('2d') };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reset(canvasAndContext: any, width: number, height: number) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
        canvasAndContext.context = canvasAndContext.canvas.getContext('2d');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      destroy(canvasAndContext: any) {
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
      }
    }

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
        pdf = await pdfjsLib
          .getDocument({
            data: new Uint8Array(buf),
            // Packaged EXE can relocate node modules; fallback keeps parsing robust.
            disableWorker: !_pdfjsWorkerAbsolute,
            // CanvasFactory (capital C) is the CLASS constructor pdfjs instantiates
            // with `new CanvasFactory({ownerDocument})`. This prevents pdfjs from
            // falling back to DOMCanvasFactory (which calls document.createElement).
            CanvasFactory: NodeCanvasFactory,
          })
          .promise;
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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((it: any) =>
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

        // Fillable forms (e.g. USCIS I-589) store the applicant's typed answers
        // in AcroForm/XFA widget values, NOT the content stream — getTextContent
        // returns only the blank template. Merge the widget values so the
        // born-digital text path captures the actual answers instead of routing
        // a near-empty page (or, for image-rendered forms, a blank render) to OCR.
        let widgetText = '';
        try {
          const lines = extractWidgetLines(await page.getAnnotations());
          if (lines.length) widgetText = '[Form field values]\n' + lines.join('\n');
        } catch {
          widgetText = '';
        }

        // Decide the page's text. Keep the corruption-safety rule: a populated-
        // but-garbled content layer still falls back to image OCR. But widget
        // values are clean structured data — include them whenever present, and
        // allow a page whose content stream is essentially empty (a pure fillable
        // form) to still take the text path on widget values alone.
        const contentUsable = isUsableTextLayer(textLayer);
        const contentEmpty =
          textLayer.replace(/\s/g, '').length < MIN_TEXT_LAYER_CHARS;
        const parts: string[] = [];
        if (contentUsable) parts.push(textLayer);
        if (widgetText && (contentUsable || contentEmpty)) parts.push(widgetText);
        const combinedText = parts.join('\n\n').trim();
        const hasTextLayer = combinedText.length >= MIN_TEXT_LAYER_CHARS;

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
          text: hasTextLayer ? combinedText : '',
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
    return safeErrorResponse(error, PRIVACY_HEADERS, 'api/pdf-pages');
  }
}

export const POST = withApiLogging('api/pdf-pages', handlePost);
