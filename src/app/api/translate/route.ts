import { NextRequest, NextResponse } from 'next/server';
import { translateDocument, translateText } from '@/lib/ai-client';

// Allow up to 60s for AI translation processing
export const maxDuration = 60;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

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

    const mimeType = file.type;
    const base64Data = Buffer.from(await file.arrayBuffer()).toString('base64');

    const result = await translateDocument(
      base64Data,
      mimeType,
      targetLanguage,
      languageHint
    );
    return NextResponse.json(result, { headers: PRIVACY_HEADERS });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Translation failed';
    const isRateLimit = message.includes('Rate limited');
    return NextResponse.json(
      { error: message, isRateLimit },
      { status: isRateLimit ? 429 : 500, headers: PRIVACY_HEADERS }
    );
  }
}
