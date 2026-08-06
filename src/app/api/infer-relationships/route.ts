import { NextRequest, NextResponse } from 'next/server';
import { inferFamilyRelationships } from '@/lib/ai-client';
import {
  enforceBodySize,
  safeErrorResponse,
  withApiLogging,
  MAX_JSON_BYTES,
} from '@/lib/api-guard';

// Allow up to 60s for relationship inference
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let documents: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let familyMembers: any[];
    let perDocNotes: Array<{ fileName: string; notes: string }> | undefined;
    try {
      ({ documents, familyMembers, perDocNotes } = await request.json());
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

    if (!familyMembers?.length || familyMembers.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 family members are required' },
        { status: 400, headers: PRIVACY_HEADERS }
      );
    }

    const result = await inferFamilyRelationships(documents, familyMembers, perDocNotes);
    const relationships = (result as Record<string, unknown>).relationships ?? [];
    return NextResponse.json({ relationships }, { headers: PRIVACY_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, PRIVACY_HEADERS, 'api/infer-relationships');
  }
}

export const POST = withApiLogging('api/infer-relationships', handlePost);
