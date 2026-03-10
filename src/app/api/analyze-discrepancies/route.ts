import { NextRequest, NextResponse } from 'next/server';
import { checkDiscrepancies } from '@/lib/ai-client';
import { z } from 'zod';

// Allow up to 60s for AI discrepancy analysis
export const maxDuration = 60;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

const DiscrepancySchema = z.object({
  hasDiscrepancies: z.boolean(),
  summary: z.string(),
});

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

    const result = await checkDiscrepancies(documents);
    const validatedResponse = DiscrepancySchema.parse(result);
    return NextResponse.json(validatedResponse, { headers: PRIVACY_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    return NextResponse.json(
      { error: message },
      { status: 500, headers: PRIVACY_HEADERS }
    );
  }
}
