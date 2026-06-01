import { NextRequest, NextResponse } from 'next/server';
import { extractText, extractStructuredFromText } from '@/lib/ai-client';
import {
  enforceBodySize,
  safeErrorResponse,
  MAX_UPLOAD_BYTES,
} from '@/lib/api-guard';

// Allow up to 60s for AI vision processing. Vercel Hobby allows configuring Node
// functions up to 60s; openaiChat retries/backoff consume part of this budget.
export const maxDuration = 60;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

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
    const languageHint = (formData.get('languageHint') as string) || undefined;
    // Born-digital PDF page: the client extracted the exact text layer, so we
    // structure that text instead of vision-OCRing a rendered image.
    const pdfText = (formData.get('pdfText') as string) || undefined;

    if (!pdfText && !file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    if (!pdfText && file && !file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Only image files are supported' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    if (file && file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `File too large. Maximum allowed is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 413, headers: PRIVACY_HEADERS }
      );
    }

    try {
      const result = pdfText
        ? await extractStructuredFromText(pdfText, languageHint)
        : await extractText(
            Buffer.from(await (file as File).arrayBuffer()).toString('base64'),
            (file as File).type,
            languageHint
          );
      // Defensive normalisation: ensure illegibility field is always present
      if (result && typeof result === 'object' && !('illegibility' in result)) {
        (result as Record<string, unknown>).illegibility = {
          detected: false,
          confidence: 'high',
        };
      }
      return NextResponse.json(result, { headers: PRIVACY_HEADERS });
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw fetchError;
    }
  } catch (error) {
    return safeErrorResponse(error, PRIVACY_HEADERS);
  }
}
