import { NextRequest, NextResponse } from 'next/server';
import { translateDocument, translateText } from '@/lib/ai-client';

// Allow up to 60s for AI translation processing
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const targetLanguage = (formData.get('targetLanguage') as string) || 'en';
    const languageHint = (formData.get('languageHint') as string) || undefined;

    // If OCR text is provided, use the cheaper text-based translation
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
      console.log('[translate-text]', file?.name ?? 'text-only', result);
      return NextResponse.json(result);
    }

    // Fallback: vision-based translation (sends the image)
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Only image files are supported' },
        { status: 400 }
      );
    }

    const base64Data = Buffer.from(await file.arrayBuffer()).toString('base64');
    const result = await translateDocument(
      base64Data,
      file.type,
      targetLanguage,
      languageHint
    );
    console.log('[translate-vision]', file.name, result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Translation error:', error);
    const message =
      error instanceof Error ? error.message : 'Translation failed';
    const isRateLimit = message.includes('Rate limited');
    return NextResponse.json(
      { error: message, isRateLimit },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}
