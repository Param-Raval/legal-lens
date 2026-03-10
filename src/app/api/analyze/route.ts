import { NextRequest, NextResponse } from 'next/server';
import { extractText } from '@/lib/ai-client';

// Allow up to 60s for AI vision processing (Vercel Pro plan; Hobby plan caps at 10s)
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

    const file = formData.get('file') as File | null;
    const languageHint = (formData.get('languageHint') as string) || undefined;

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

    try {
      const result = await extractText(base64Data, mimeType, languageHint);
      return NextResponse.json(result, { headers: PRIVACY_HEADERS });
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw fetchError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    const isRateLimit = message.includes('Rate limited');
    return NextResponse.json(
      { error: message, isRateLimit },
      { status: isRateLimit ? 429 : 500, headers: PRIVACY_HEADERS }
    );
  }
}
