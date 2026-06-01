import { NextRequest, NextResponse } from 'next/server';

/**
 * Shared route guards: input-size limits and error sanitization.
 *
 * These routes are a proxy to a billed AI provider; capping body size limits the
 * blast radius of large/abusive payloads (memory + cost + the 60s function wall),
 * and sanitizing errors prevents leaking internal paths/config/parser details to
 * the caller. NOTE: these do NOT replace authentication / rate limiting — see the
 * deployment notes; a public deployment still needs Vercel WAF / per-user auth.
 */

/** Max raw upload (image/PDF/docx) accepted by file routes. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
/** Max JSON payload accepted by analysis/report routes. */
export const MAX_JSON_BYTES = 10 * 1024 * 1024; // 10 MB

/** Returns a 413 response if Content-Length exceeds the cap, else null. */
export function enforceBodySize(
  request: NextRequest,
  maxBytes: number,
  headers?: HeadersInit
): NextResponse | null {
  const len = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(len) && len > maxBytes) {
    return NextResponse.json(
      { error: `Request too large. Maximum allowed is ${Math.floor(maxBytes / (1024 * 1024))} MB.` },
      { status: 413, headers }
    );
  }
  return null;
}

/**
 * Map an internal error to a safe, generic client response. Only an allowlist of
 * user-actionable conditions (rate limit, content filter, missing config) gets a
 * specific message; everything else returns a generic 500 with the real error
 * logged server-side. Preserves the `isRateLimit` flag the client retries on.
 */
export function safeErrorResponse(
  error: unknown,
  headers?: HeadersInit
): NextResponse {
  const raw = error instanceof Error ? error.message : '';
  console.error('[api] route error:', error);

  if (/rate limit/i.test(raw)) {
    return NextResponse.json(
      { error: 'The AI service is busy (rate limited). Please wait a moment and try again.', isRateLimit: true },
      { status: 429, headers }
    );
  }
  if (/content safety filter/i.test(raw)) {
    return NextResponse.json(
      { error: 'The request was blocked by the content safety filter and cannot be processed.' },
      { status: 422, headers }
    );
  }
  if (/is not set|not a valid URL|Configure it in Settings/i.test(raw)) {
    return NextResponse.json(
      { error: 'The AI provider is not configured. Please check Settings.' },
      { status: 503, headers }
    );
  }
  return NextResponse.json(
    { error: 'Something went wrong while processing this request. Please try again.' },
    { status: 500, headers }
  );
}
