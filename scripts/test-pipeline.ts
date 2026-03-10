/**
 * Test Pipeline — runs the full AI workflow without a browser or server.
 *
 * Usage:
 *   pnpm test-pipeline
 *   or:
 *   npx tsx --env-file=.env.local scripts/test-pipeline.ts
 *
 * Requires .env.local with the AI provider credentials.
 * The 3 sample files are read from disk; no UI is involved.
 *
 * Pipeline stages:
 *   1. PDF text extraction  (pdfjs-dist legacy, embedded text — no canvas)
 *   2. Image OCR            (extractText via AI vision)
 *   3. Translation          (translateText / translateDocument via AI)
 *   4. Discrepancy check    (checkDiscrepancies via AI)
 *   5. Report generation    (generateReport via AI)
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';
import {
  extractText,
  translateText,
  translateDocument,
  checkDiscrepancies,
  generateReport,
} from '../src/lib/ai-client.js';
import type { DocumentGroup, OCRResult, TranslationResult } from '../src/types/index.js';

// ── Config ──────────────────────────────────────────────────────────────

const SAMPLE_FILES = {
  pdf: '.\\sample_docs\\Other\\Honeybee-Biosimilar-Program-Summary.pdf',
  png3: '.\\sample_docs\\Afghan\\Afghan Tazkera P3.png',
  png4: '.\\sample_docs\\Afghan\\Afghan Tazkera P4.png',
};

// Language hints for the Afghan identity documents
const AFGHAN_LANG_HINT = 'fa_AF'; // Dari

// ── Helpers ─────────────────────────────────────────────────────────────

function log(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${tag.padEnd(20)} ${msg}`);
}

function logJSON(label: string, obj: unknown) {
  console.log(`\n─── ${label} ${'─'.repeat(60 - label.length)}`);
  console.log(JSON.stringify(obj, null, 2));
  console.log();
}

async function readFileBase64(path: string): Promise<{ base64: string; mimeType: string; name: string }> {
  const buf = await readFile(path);
  const ext = path.split('.').pop()?.toLowerCase();
  const mimeType = ext === 'pdf' ? 'application/pdf'
    : ext === 'png' ? 'image/png'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : 'application/octet-stream';
  return { base64: buf.toString('base64'), mimeType, name: basename(path) };
}

// ── PDF text extraction (no canvas, Node.js compatible) ─────────────────

async function extractPdfTextPages(pdfPath: string): Promise<Array<{ page: number; text: string }>> {
  // Use process.cwd() (project root) to locate the worker; avoids import.meta.url
  // which requires explicit ESM context in some TypeScript configurations.
  const workerPath = resolve(
    process.cwd(),
    'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'
  );

  const { getDocument, GlobalWorkerOptions } = await import(
    'pdfjs-dist/legacy/build/pdf.mjs'
  ) as typeof import('pdfjs-dist');

  GlobalWorkerOptions.workerSrc = new URL(
    'file:///' + workerPath.replace(/\\/g, '/')
  ).toString();

  const buf = await readFile(pdfPath);
  // Suppress the standardFontDataUrl warnings — they don't affect text extraction
  const originalWarn = console.warn;
  console.warn = () => {};
  const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
  console.warn = originalWarn;

  const pages: Array<{ page: number; text: string }> = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = (tc.items as Array<{ str: string }>).map(item => item.str).join(' ');
    pages.push({ page: i, text: text.trim() });
  }
  return pages;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  // Validate sample files exist
  for (const [key, path] of Object.entries(SAMPLE_FILES)) {
    if (!existsSync(path)) {
      console.error(`✗ Sample file missing (${key}): ${path}`);
      process.exit(1);
    }
  }
  log('STARTUP', 'All sample files found.');

  const groups: DocumentGroup[] = [];

  // ── Stage 1: PDF — extract embedded text, translate each page ──────────
  log('PDF', `Extracting text from ${basename(SAMPLE_FILES.pdf)} …`);
  const pdfPages = await extractPdfTextPages(SAMPLE_FILES.pdf);
  log('PDF', `Extracted ${pdfPages.length} page(s).`);

  const pdfGroupPages: DocumentGroup['pages'] = [];
  for (const { page, text } of pdfPages) {
    log('PDF OCR', `Page ${page}: ${text.length} chars (embedded text, no vision OCR needed)`);

    // Build a synthetic OCRResult from the embedded PDF text
    const pdfOcr: OCRResult = {
      text,
      document_type: 'program_summary',
      document_language: 'en',
      structured_data: { fields: [] },
    };

    // Translation: English PDF — skip translation (source is already English)
    pdfGroupPages.push({
      pageNumber: page,
      name: `${basename(SAMPLE_FILES.pdf)} — Page ${page}`,
      extracted_data: pdfOcr,
      translation_data: null,
    });
  }

  groups.push({
    name: basename(SAMPLE_FILES.pdf),
    groupId: 'pdf-group',
    pages: pdfGroupPages,
  });

  // ── Stage 2: Afghan Tazkera P3 — vision OCR + translation ──────────────
  for (const [label, path, hint] of [
    ['Afghan P3', SAMPLE_FILES.png3, AFGHAN_LANG_HINT],
    ['Afghan P4', SAMPLE_FILES.png4, AFGHAN_LANG_HINT],
  ] as const) {
    log(label, `Reading ${basename(path)} …`);
    const { base64, mimeType } = await readFileBase64(path);

    log(label, 'Running vision OCR …');
    const ocrRaw = await extractText(base64, mimeType, hint);
    const ocr = ocrRaw as OCRResult;
    log(label, `OCR done — type: ${ocr.document_type}, lang: ${ocr.document_language}`);
    logJSON(`${label} — OCR result`, ocr);

    log(label, 'Running translation …');
    let translation: TranslationResult | null = null;
    if (ocr.document_language && ocr.document_language !== 'en') {
      if (ocr.text) {
        const fields = ocr.structured_data?.fields ?? [];
        const raw = await translateText(ocr.text, fields, ocr.document_language, 'en', hint);
        translation = raw as unknown as TranslationResult;
      } else {
        // Fall back to vision translation if OCR text is empty
        const raw = await translateDocument(base64, mimeType, 'en', hint);
        translation = raw as unknown as TranslationResult;
      }
      log(label, 'Translation done.');
      logJSON(`${label} — Translation result`, translation);
    } else {
      log(label, 'Document is already English — skipping translation.');
    }

    groups.push({
      name: basename(path),
      groupId: label.replace(' ', '-').toLowerCase(),
      pages: [
        {
          pageNumber: 1,
          name: basename(path),
          extracted_data: ocr,
          translation_data: translation,
        },
      ],
    });
  }

  // ── Stage 3: Discrepancy check ──────────────────────────────────────────
  log('DISCREPANCY', 'Checking discrepancies across all documents …');
  const discrepancy = await checkDiscrepancies(groups);
  logJSON('Discrepancy Check', discrepancy);

  // ── Stage 4: Report generation ──────────────────────────────────────────
  log('REPORT', 'Generating full analysis report …');
  const report = await generateReport(groups);
  logJSON('Full Report', report);

  log('DONE', '✓ Pipeline completed successfully.');
}

main().catch(err => {
  console.error('\n✗ Pipeline failed:', err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
