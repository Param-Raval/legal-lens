import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// On Vercel the project directory is read-only; use /tmp for ephemeral writes.
const isVercel = !!process.env.VERCEL;
const OUTPUT_DIR = isVercel
  ? path.join(os.tmpdir(), 'output')
  : path.join(process.cwd(), 'output');

/**
 * Save OCR / translation results to disk.
 *
 * Body JSON:
 * {
 *   clientName: string,
 *   fileName: string,
 *   ocr?: OCRResult,
 *   translation?: TranslationResult
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { clientName, fileName, ocr, translation } = await request.json();

    if (!fileName) {
      return NextResponse.json(
        { error: 'fileName is required' },
        { status: 400 }
      );
    }

    const sanitizedClient = (clientName || 'Client')
      .replace(/[^a-zA-Z0-9_\- ]/g, '')
      .replace(/\s+/g, '_');

    // Create client sub-folder inside output/
    const clientDir = path.join(OUTPUT_DIR, sanitizedClient);
    await fs.mkdir(clientDir, { recursive: true });

    // Derive a base name from the original file (strip extension)
    const baseName = fileName.replace(/\.[^.]+$/, '').replace(/\s+/g, '_');

    const savedFiles: string[] = [];

    // ── Save OCR result ────────────────────────────────────────────────
    if (ocr) {
      const ocrLines: string[] = [];
      ocrLines.push(`=== OCR RESULT: ${fileName} ===`);
      ocrLines.push(`Document Type: ${ocr.document_type || 'unknown'}`);
      ocrLines.push(`Language: ${ocr.document_language || 'unknown'}`);
      ocrLines.push('');
      ocrLines.push('--- Extracted Text ---');
      ocrLines.push(ocr.text || '(no text)');

      if (ocr.structured_data?.fields?.length) {
        ocrLines.push('');
        ocrLines.push('--- Structured Fields ---');
        for (const field of ocr.structured_data.fields) {
          ocrLines.push(`  ${field.key}: ${field.value}`);
        }
      }

      if (ocr.tables?.length) {
        ocrLines.push('');
        ocrLines.push('--- Tables ---');
        for (const table of ocr.tables) {
          if (table.headers?.length) {
            ocrLines.push(`  | ${table.headers.join(' | ')} |`);
            ocrLines.push(
              `  | ${table.headers.map(() => '---').join(' | ')} |`
            );
          }
          for (const row of table.rows || []) {
            ocrLines.push(`  | ${row.join(' | ')} |`);
          }
          ocrLines.push('');
        }
      }

      const ocrPath = path.join(clientDir, `${baseName}_ocr.txt`);
      await fs.writeFile(ocrPath, ocrLines.join('\n'), 'utf-8');
      savedFiles.push(ocrPath);
    }

    // ── Save Translation result ────────────────────────────────────────
    if (translation) {
      const tLines: string[] = [];
      tLines.push(`=== TRANSLATION: ${fileName} ===`);
      tLines.push(
        `Original Language: ${translation.original_language || 'unknown'}`
      );
      tLines.push(`Target Language: ${translation.target_language || 'en'}`);
      tLines.push('');

      tLines.push('--- Original Text ---');
      tLines.push(translation.original_text || '(no text)');
      tLines.push('');

      tLines.push('--- Translated Text ---');
      tLines.push(translation.translated_text || '(no text)');

      if (
        translation.image_text?.original ||
        translation.image_text?.translated
      ) {
        tLines.push('');
        tLines.push('--- Image / Stamp Text ---');
        if (translation.image_text.original) {
          tLines.push(`Original: ${translation.image_text.original}`);
        }
        if (translation.image_text.translated) {
          tLines.push(`Translated: ${translation.image_text.translated}`);
        }
      }

      if (translation.structured_data?.translated_fields?.length) {
        tLines.push('');
        tLines.push('--- Translated Fields ---');
        for (const field of translation.structured_data.translated_fields) {
          tLines.push(`  ${field.key}: ${field.value}`);
        }
      }

      if (translation.notes) {
        tLines.push('');
        tLines.push('--- Notes ---');
        tLines.push(translation.notes);
      }

      const translationPath = path.join(
        clientDir,
        `${baseName}_translation.txt`
      );
      await fs.writeFile(translationPath, tLines.join('\n'), 'utf-8');
      savedFiles.push(translationPath);
    }

    const res = NextResponse.json({ saved: savedFiles });
    // Warn callers that files on Vercel are ephemeral (/tmp is per-invocation)
    if (isVercel) {
      res.headers.set('X-Vercel-Warning', 'Files are ephemeral and will not persist between requests');
    }
    return res;
  } catch (error) {
    console.error('Save results error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to save results',
      },
      { status: 500 }
    );
  }
}
