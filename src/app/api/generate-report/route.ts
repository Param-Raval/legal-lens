import { NextRequest, NextResponse } from 'next/server';
import { generateReport } from '@/lib/ai-client';
import {
  enforceBodySize,
  safeErrorResponse,
  withApiLogging,
  MAX_JSON_BYTES,
} from '@/lib/api-guard';
import type { ClassifiedFieldFinding, DocumentSummary, ParsedIntent } from '@/types';

// Allow up to 60s for report generation.
// Vercel Hobby plan caps at 60s; upgrade to Pro for longer timeouts.
export const maxDuration = 60;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

async function handlePost(request: NextRequest) {
  try {
    const tooLarge = enforceBodySize(request, MAX_JSON_BYTES, PRIVACY_HEADERS);
    if (tooLarge) return tooLarge;

    let summaries: DocumentSummary[];
    let excludedDocuments: Array<{ name: string; reason: string }> | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let familyGraph: any | undefined;
    let parsedIntent: ParsedIntent | undefined;
    let fieldFindings: ClassifiedFieldFinding[] | undefined;
    try {
      ({ summaries, excludedDocuments, familyGraph, parsedIntent, fieldFindings } = await request.json());
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    if (!summaries?.length) {
      return NextResponse.json(
        { error: 'No document summaries provided' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    const report = await generateReport(summaries, excludedDocuments, familyGraph, parsedIntent, fieldFindings);
    return NextResponse.json(report, { headers: PRIVACY_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, PRIVACY_HEADERS, 'api/generate-report');
  }
}

export const POST = withApiLogging('api/generate-report', handlePost);
