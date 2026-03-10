/**
 * Client-side PDF page extraction.
 *
 * Sends the PDF to the /api/pdf-pages route where pdfjs-dist renders each
 * page to a JPEG in Node.js (server-side). The browser never loads pdfjs-dist
 * directly, which avoids webpack re-bundling conflicts that cause:
 *   "Object.defineProperty called on non-object"
 *
 * All document data is transmitted over a same-origin fetch; no third-party
 * service receives any document content.
 */
import type { FileInfo } from '@/types';

/** Maximum number of pages extracted per PDF. */
const MAX_PAGES = 10;

export interface PdfExtractionResult {
  pages: FileInfo[];
  /** True if the PDF had more pages than MAX_PAGES. */
  truncated: boolean;
  /** Total page count in the source PDF. */
  totalPagesInPdf: number;
}

/**
 * Extract up to `maxPages` page images from a PDF file by sending it to
 * the /api/pdf-pages server route, which renders pages using pdfjs-dist in
 * Node.js. The JPEG images are returned as File objects identical in shape to
 * directly-uploaded image files.
 *
 * @throws Error with a user-friendly message for encrypted or corrupt PDFs.
 */
export async function extractPdfPages(
  file: File,
  maxPages: number = MAX_PAGES
): Promise<PdfExtractionResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('maxPages', String(maxPages));

  const response = await fetch('/api/pdf-pages', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      body.error ?? `PDF processing failed (HTTP ${response.status})`
    );
  }

  const result = (await response.json()) as {
    totalPagesInPdf: number;
    pagesToExtract: number;
    truncated: boolean;
    pages: Array<{
      pageNumber: number;
      jpeg: string;
      width: number;
      height: number;
    }>;
  };

  const pdfSourceId = crypto.randomUUID();
  const pdfSourceName = file.name;

  const pages: FileInfo[] = result.pages.map(({ pageNumber, jpeg, width, height }) => {
    // Decode base64 JPEG back to a File object
    const byteString = atob(jpeg);
    const byteArray = new Uint8Array(byteString.length);
    for (let j = 0; j < byteString.length; j++) {
      byteArray[j] = byteString.charCodeAt(j);
    }
    const blob = new Blob([byteArray], { type: 'image/jpeg' });
    const jpegFile = new File(
      [blob],
      `${pdfSourceName}_page_${pageNumber}.jpg`,
      { type: 'image/jpeg' }
    );

    return {
      id: `${pdfSourceId}-page-${pageNumber}`,
      name: `${pdfSourceName} — Page ${pageNumber}`,
      size: jpegFile.size,
      type: 'image/jpeg',
      file: jpegFile,
      pdfSourceId,
      pdfSourceName,
      pdfPageNumber: pageNumber,
      pdfTotalPages: result.pagesToExtract,
    } as FileInfo;
  });

  return {
    pages,
    truncated: result.truncated,
    totalPagesInPdf: result.totalPagesInPdf,
  };
}

