import { NextRequest, NextResponse } from 'next/server';
import { generateReport } from '@/lib/ai-client';

// Allow up to 60s for report generation.
// Vercel Hobby plan caps at 60s; upgrade to Pro for longer timeouts.
export const maxDuration = 60;

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
