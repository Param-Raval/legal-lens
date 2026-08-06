import { NextResponse } from 'next/server';
import { resolveReportMode } from '@/lib/report-mode';

// Must be evaluated per request, never prerendered at build time — resolving the
// mode at build time is exactly the bug this endpoint exists to fix.
export const dynamic = 'force-dynamic';

/**
 * Return the effective report mode ("light" | "deep") for this deployment.
 *
 * The client calls this immediately before generating a report so a Settings
 * change (which rewrites .env and updates the running process) applies without
 * a restart. The response carries no secrets — just which of the two pipeline
 * shapes to run.
 */
export async function GET() {
  return NextResponse.json(
    { mode: resolveReportMode() },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
