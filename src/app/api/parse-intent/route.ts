import { NextRequest, NextResponse } from 'next/server';
import { parseUserIntent } from '@/lib/ai-client';
import {
  enforceBodySize,
  safeErrorResponse,
  withApiLogging,
  MAX_JSON_BYTES,
} from '@/lib/api-guard';

// Allow up to 30s — this is a lightweight micro-agent call
export const maxDuration = 30;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

async function handlePost(request: NextRequest) {
  try {
    const tooLarge = enforceBodySize(request, MAX_JSON_BYTES, PRIVACY_HEADERS);
    if (tooLarge) return tooLarge;

    let analysisContext: string;
    let perDocNotes: Array<{ fileName: string; notes: string }> | undefined;

    try {
      ({ analysisContext, perDocNotes } = await request.json());
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    if (!analysisContext?.trim()) {
      return NextResponse.json(
        { error: 'analysisContext is required and must be non-empty' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    const parsedIntent = await parseUserIntent(
      analysisContext,
      perDocNotes ?? []
    );

    return NextResponse.json(parsedIntent, { headers: PRIVACY_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, PRIVACY_HEADERS, 'api/parse-intent');
  }
}

export const POST = withApiLogging('api/parse-intent', handlePost);
