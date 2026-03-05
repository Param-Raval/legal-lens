import { NextRequest, NextResponse } from 'next/server';
import { extractText } from '@/lib/ai-client';
import { del } from '@vercel/blob';

// Allow up to 60s for AI vision processing (Vercel Pro plan; Hobby plan caps at 10s)
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const blobUrl = (formData.get('blobUrl') as string | null) || undefined;
    const languageHint = (formData.get('languageHint') as string) || undefined;

    let base64Data: string;
    let mimeType: string;

    if (blobUrl) {
      // ── Private Blob path (production) ──────────────────────────────
      // Fetch the file from the private Vercel Blob store using the
      // read-write token, then immediately delete it so it is not retained.
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

      // Delete immediately after reading – fire-and-forget; don't block response.
      del(blobUrl).catch(() => undefined);
    } else {
      // ── Direct file-bytes path (local dev fallback) ──────────────────
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

    try {
      const result = await extractText(base64Data, mimeType, languageHint);
      return NextResponse.json(result);
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
      { status: isRateLimit ? 429 : 500 }
    );
  }
}

