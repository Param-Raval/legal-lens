import { NextRequest, NextResponse } from 'next/server';
import { checkDiscrepancies } from '@/lib/ai-client';
import { z } from 'zod';

// Allow up to 60s for AI discrepancy analysis
export const maxDuration = 60;

const DiscrepancySchema = z.object({
  hasDiscrepancies: z.boolean(),
  summary: z.string(),
});

export async function POST(request: NextRequest) {
  try {
    const { documents } = await request.json();

    if (!documents?.length) {
      return NextResponse.json(
        { error: 'No documents provided' },
        { status: 400 }
      );
    }

    const result = await checkDiscrepancies(documents);
    const validatedResponse = DiscrepancySchema.parse(result);
    return NextResponse.json(validatedResponse);
  } catch (error) {
    console.error('Discrepancy analysis error:', error);
    const message = error instanceof Error ? error.message : 'Analysis failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
