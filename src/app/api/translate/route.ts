import { NextRequest, NextResponse } from 'next/server';
import { translateDocument, translateText } from '@/lib/ai-client';
import { del } from '@vercel/blob';

// Allow up to 60s for AI translation processing
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
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
      return NextResponse.json(result);
    }

    // ── Vision-based translation fallback (translate before OCR) ─────
    const blobUrl = (formData.get('blobUrl') as string | null) || undefined;

    let base64Data: string;
    let mimeType: string;

    if (blobUrl) {
      // Fetch from private Vercel Blob and delete immediately after reading.
      const blobRes = await fetch(blobUrl, {
        headers: {
          Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
        },
      });

      if (!blobRes.ok) {
        return NextResponse.json(
          { error: 'Failed to retrieve file from secure storage' },
          { status: 500 }
        );
      }

      mimeType =
        blobRes.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
      base64Data = Buffer.from(await blobRes.arrayBuffer()).toString('base64');

      del(blobUrl).catch(() => undefined);
    } else {
      // Local dev fallback: accept raw file bytes.
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json(
          { error: 'No file provided' },
          { status: 400 }
        );
      }

      if (!file.type.startsWith('image/')) {
        return NextResponse.json(
          { error: 'Only image files are supported' },
          { status: 400 }
        );
      }

      mimeType = file.type;
      base64Data = Buffer.from(await file.arrayBuffer()).toString('base64');
    }

    const result = await translateDocument(
      base64Data,
      mimeType,
      targetLanguage,
      languageHint
    );
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Translation failed';
    const isRateLimit = message.includes('Rate limited');
    return NextResponse.json(
      { error: message, isRateLimit },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}

