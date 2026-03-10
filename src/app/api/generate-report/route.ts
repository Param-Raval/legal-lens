import { NextRequest, NextResponse } from 'next/server';
import { generateReport } from '@/lib/ai-client';

// Allow up to 60s for report generation.
// Vercel Hobby plan caps at 60s; upgrade to Pro for longer timeouts.
export const maxDuration = 60;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

export async function POST(request: NextRequest) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let documents: any[];
    try {
      ({ documents } = await request.json());
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    if (!documents?.length) {
      return NextResponse.json(
        { error: 'No documents provided' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    const report = await generateReport(documents);
    return NextResponse.json(report, { headers: PRIVACY_HEADERS });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Report generation failed';
    const isRateLimit = message.includes('Rate limited');
    return NextResponse.json(
      { error: message, isRateLimit },
      { status: isRateLimit ? 429 : 500, headers: PRIVACY_HEADERS }
    );
  }
}
