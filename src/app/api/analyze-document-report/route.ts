import { NextRequest, NextResponse } from 'next/server';
import { analyzeDocumentDeep } from '@/lib/ai-client';
import { enforceBodySize, safeErrorResponse, MAX_JSON_BYTES } from '@/lib/api-guard';
import type { DocumentGroup } from '@/types';

// Allow up to 60s per document in deep analysis mode.
export const maxDuration = 60;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

/**
 * POST /api/analyze-document-report
 *
 * Deep mode Phase 1 (Map) endpoint.
 * Accepts a single DocumentGroup, returns a compact DocumentSummary.
 * The client calls this in parallel for each document when REPORT_MODE=deep.
 */
export async function POST(request: NextRequest) {
  try {
    const tooLarge = enforceBodySize(request, MAX_JSON_BYTES, PRIVACY_HEADERS);
    if (tooLarge) return tooLarge;

    let group: DocumentGroup | undefined;
    try {
      ({ group } = await request.json());
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    if (!group) {
      return NextResponse.json(
        { error: 'No document group provided' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    const summary = await analyzeDocumentDeep(group);
    return NextResponse.json(summary, { headers: PRIVACY_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, PRIVACY_HEADERS);
  }
}
