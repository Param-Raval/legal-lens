import { NextRequest, NextResponse } from 'next/server';
import { extractText } from '@/lib/ai-client';

// Allow up to 60s for AI vision processing (Vercel Pro plan; Hobby plan caps at 10s)
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

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
    const languageHint = (formData.get('languageHint') as string) || undefined;

    try {
      const result = await extractText(base64Data, file.type, languageHint);
      console.log('[analyze]', file.name, result);
      return NextResponse.json(result);
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw fetchError;
    }
  } catch (error) {
    console.error('Analysis error:', error);
    const message = error instanceof Error ? error.message : 'Analysis failed';
    const isRateLimit = message.includes('Rate limited');
    return NextResponse.json(
      { error: message, isRateLimit },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}
