import { NextRequest, NextResponse } from 'next/server';
import { checkDiscrepancies } from '@/lib/ai-client';
import {
  enforceBodySize,
  safeErrorResponse,
  withApiLogging,
  MAX_JSON_BYTES,
} from '@/lib/api-guard';
import type { ParsedIntent } from '@/types';
import { z } from 'zod';

// Allow up to 60s for AI discrepancy analysis
export const maxDuration = 60;

/** Privacy headers – prevent any edge / CDN caching of document data. */
const PRIVACY_HEADERS = {
  'Cache-Control': 'private, no-store, no-cache, must-revalidate',
  'X-Content-Type-Options': 'nosniff',
} as const;

const FieldFindingSchema = z.object({
  field: z.string(),
  canonicalName: z.string(),
  status: z.enum(['consistent', 'inconsistent', 'missing_info', 'requires_review']),
  note: z.string().nullable(),
  documentsInvolved: z.array(z.string()),
  valuesByDocument: z.array(z.object({
    document: z.string(),
    original: z.string(),
    translated: z.string(),
  })),
  severity: z.enum(['High', 'Medium', 'Low']).optional(),
});

const DiscrepancySchema = z.object({
  hasDiscrepancies: z.boolean(),
  summary: z.string(),
  fieldFindings: z.array(FieldFindingSchema).optional(),
  classificationFailed: z.boolean().optional(),
});

async function handlePost(request: NextRequest) {
  try {
    const tooLarge = enforceBodySize(request, MAX_JSON_BYTES, PRIVACY_HEADERS);
    if (tooLarge) return tooLarge;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let documents: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let familyGraph: any | undefined;
    let parsedIntent: ParsedIntent | undefined;
    let perDocNotes: Array<{ fileName: string; notes: string }> | undefined;
    let docLegibility:
      | Array<{ name: string; legibility?: 'Good' | 'Fair' | 'Poor'; isHandwritten?: boolean }>
      | undefined;
    try {
      ({ documents, familyGraph, parsedIntent, perDocNotes, docLegibility } = await request.json());
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

    const result = await checkDiscrepancies(documents, familyGraph, parsedIntent, perDocNotes, docLegibility);
    const validatedResponse = DiscrepancySchema.parse(result);
    return NextResponse.json(validatedResponse, { headers: PRIVACY_HEADERS });
  } catch (error) {
    return safeErrorResponse(error, PRIVACY_HEADERS, 'api/analyze-discrepancies');
  }
}

export const POST = withApiLogging('api/analyze-discrepancies', handlePost);
