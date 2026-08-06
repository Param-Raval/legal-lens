import { NextRequest, NextResponse } from 'next/server';
import { translateDocument, translateText } from '@/lib/ai-client';
import {
  enforceBodySize,
  safeErrorResponse,
  withApiLogging,
  MAX_UPLOAD_BYTES,
} from '@/lib/api-guard';

// Allow up to 60s for AI translation processing (Vercel Hobby caps at 60s).
export const maxDuration = 60;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

async function handlePost(request: NextRequest) {
  try {
    const tooLarge = enforceBodySize(request, MAX_UPLOAD_BYTES, PRIVACY_HEADERS);
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

    const targetLanguage = (formData.get('targetLanguage') as string) || 'en';
    const languageHint = (formData.get('languageHint') as string) || undefined;

    // ── Text-based translation (preferred – no image bytes needed) ────
    const ocrText = (formData.get('ocrText') as string) || undefined;
    const ocrFields = (formData.get('ocrFields') as string) || undefined;
    const ocrLanguage = (formData.get('ocrLanguage') as string) || undefined;

    if (ocrText && ocrLanguage) {
      const fields = ocrFields ? JSON.parse(ocrFields) : [];
      const result = await translateText(
        ocrText,
        fields,
        ocrLanguage,
        targetLanguage,
        languageHint
      );
      // Defensive normalisation: ensure illegibility field is always present
      if (result && typeof result === 'object' && !('illegibility' in result)) {
        (result as Record<string, unknown>).illegibility = {
          uncertain_segments: [],
          overall_confidence: 'high',
        };
      }
      return NextResponse.json(result, { headers: PRIVACY_HEADERS });
    }

    // ── Vision-based translation fallback (translate before OCR) ─────
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Only image files are supported' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File too large. Maximum allowed is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.` },
        { status: 413, headers: PRIVACY_HEADERS }
      );
    }

    const mimeType = file.type;
    const base64Data = Buffer.from(await file.arrayBuffer()).toString('base64');

    const result = await translateDocument(
      base64Data,
      mimeType,
      targetLanguage,
      languageHint
    );
    // Defensive normalisation: ensure illegibility field is always present
    if (result && typeof result === 'object' && !('illegibility' in result)) {
      (result as Record<string, unknown>).illegibility = {
        uncertain_segments: [],
        overall_confidence: 'high',
      };
    }
    return NextResponse.json(result, { headers: PRIVACY_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, PRIVACY_HEADERS, 'api/translate');
  }
}

export const POST = withApiLogging('api/translate', handlePost);
