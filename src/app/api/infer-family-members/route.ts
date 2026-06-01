import { NextRequest, NextResponse } from 'next/server';
import { inferFamilyMembers } from '@/lib/ai-client';
import { enforceBodySize, safeErrorResponse, MAX_JSON_BYTES } from '@/lib/api-guard';

// Allow up to 30s for family member inference.
export const maxDuration = 30;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

/**
 * POST /api/infer-family-members
 *
 * Auto-detect family members from analyzed documents.
 * Called during the pipeline when family mode is enabled but no members have been manually added.
 * Returns array of inferred FamilyMember objects with assigned colors.
 */
export async function POST(request: NextRequest) {
  try {
    const tooLarge = enforceBodySize(request, MAX_JSON_BYTES, PRIVACY_HEADERS);
    if (tooLarge) return tooLarge;

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

    const result = await inferFamilyMembers(documents);
    return NextResponse.json(result, { headers: PRIVACY_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, PRIVACY_HEADERS);
  }
}
