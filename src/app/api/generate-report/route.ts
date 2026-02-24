import { NextRequest, NextResponse } from 'next/server';
import { generateReport } from '@/lib/ai-client';

// Allow up to 120s for report generation (largest prompt, most tokens)
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { documents } = await request.json();

    if (!documents?.length) {
      return NextResponse.json(
        { error: 'No documents provided' },
        { status: 400 }
      );
    }

    const report = await generateReport(documents);
    console.log('[report] Generated report for', documents.length, 'documents');
    return NextResponse.json(report);
  } catch (error) {
    console.error('Report generation error:', error);
    const message =
      error instanceof Error ? error.message : 'Report generation failed';
    const isRateLimit = message.includes('Rate limited');
    return NextResponse.json(
      { error: message, isRateLimit },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}
