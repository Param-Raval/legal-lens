import { NextRequest, NextResponse } from 'next/server';
import { describeError, log, logRuntimeOnce, newRef } from './logger';
import { ProviderHttpError } from './provider-error';

/**
 * Shared route guards: input-size limits, request logging, and error reporting.
 *
 * These routes are a proxy to a billed AI provider; capping body size limits the
 * blast radius of large/abusive payloads (memory + cost + the 60s function wall).
 * NOTE: these do NOT replace authentication / rate limiting — see the deployment
 * notes; a public deployment still needs Vercel WAF / per-user auth.
 *
 * On errors, the goal is to tell the user what to DO without leaking internals.
 * The previous version collapsed everything except a few patterns into "Something
 * went wrong while processing this request. Please try again." — which sent users
 * to retry an invalid API key forever. Errors are now classified by kind, told
 * plainly, and stamped with a reference id that also appears in the server log.
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
      {
        error: `Request too large. Maximum allowed is ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
      },
      { status: 413, headers }
    );
  }
  return null;
}

interface Classified {
  status: number;
  /** Message shown to the user. Must be actionable and free of internals. */
  error: string;
  /** Machine-readable kind, for the client and for log correlation. */
  kind: string;
  /** Set when the client's retry logic should treat this as a rate limit. */
  isRateLimit?: boolean;
  /** False when retrying cannot possibly succeed (bad key, bad deployment). */
  retryable: boolean;
}

/**
 * Map an internal error to a user-facing kind, status, and message.
 *
 * Everything here is either a fixed string we wrote or a provider-authored
 * platform message (never request content) — see readProviderError.
 */
function classify(error: unknown): Classified {
  // ── Provider returned an HTTP error ────────────────────────────────────
  if (error instanceof ProviderHttpError) {
    const detail = error.providerMessage
      ? ` Provider said: ${error.providerMessage}`
      : '';

    if (error.status === 401 || error.status === 403) {
      return {
        status: 502,
        kind: 'provider_auth',
        retryable: false,
        error:
          `The AI provider rejected the credentials (HTTP ${error.status}). ` +
          `Open Settings and check the API key and endpoint URL — retrying will not help until they are fixed.${detail}`,
      };
    }
    if (error.status === 404) {
      return {
        status: 502,
        kind: 'provider_not_found',
        retryable: false,
        error:
          `The AI provider could not find the configured deployment (HTTP 404). ` +
          `Check the deployment name and endpoint URL in Settings.${detail}`,
      };
    }
    if (error.status === 429) {
      return {
        status: 429,
        kind: 'rate_limit',
        isRateLimit: true,
        retryable: true,
        error:
          'The AI service is busy (rate limited). Please wait a moment and try again.',
      };
    }
    if (error.status === 400) {
      return {
        status: 502,
        kind: 'provider_bad_request',
        retryable: false,
        error:
          `The AI provider rejected the request (HTTP 400). This usually means the model or deployment ` +
          `does not support what was asked of it — check the deployment name in Settings.${detail}`,
      };
    }
    if (error.status >= 500) {
      return {
        status: 502,
        kind: 'provider_unavailable',
        retryable: true,
        error: `The AI service reported a temporary problem (HTTP ${error.status}). Please try again in a moment.`,
      };
    }
    return {
      status: 502,
      kind: 'provider_error',
      retryable: true,
      error: `The AI service returned an unexpected response (HTTP ${error.status}).${detail}`,
    };
  }

  const raw = error instanceof Error ? error.message : '';

  // ── Rate limit surfaced as a plain Error (after retries are exhausted) ──
  if (/rate limit/i.test(raw)) {
    return {
      status: 429,
      kind: 'rate_limit',
      isRateLimit: true,
      retryable: true,
      error:
        'The AI service is busy (rate limited). Please wait a moment and try again.',
    };
  }

  // ── Content safety ─────────────────────────────────────────────────────
  if (/content safety filter/i.test(raw)) {
    return {
      status: 422,
      kind: 'content_filter',
      retryable: false,
      error:
        'The request was blocked by the content safety filter and cannot be processed.',
    };
  }

  // ── Missing / invalid configuration, raised by validateConfig() ─────────
  if (/is not set|not a valid URL|Configure it in Settings/i.test(raw)) {
    return {
      status: 503,
      kind: 'not_configured',
      retryable: false,
      error: `The AI provider is not configured. Open Settings and fill in the details. (${raw})`,
    };
  }

  // ── Could not reach the provider at all ────────────────────────────────
  if (/Could not reach the Ollama server/i.test(raw)) {
    return {
      status: 503,
      kind: 'provider_unreachable',
      retryable: true,
      error: raw,
    };
  }
  if (/Network error contacting/i.test(raw)) {
    return {
      status: 503,
      kind: 'provider_unreachable',
      retryable: true,
      error:
        'Could not reach the AI service. Check the network connection and the endpoint URL in Settings.',
    };
  }

  // ── Timeouts ───────────────────────────────────────────────────────────
  if (
    /timed out|timeout/i.test(raw) ||
    (error instanceof Error &&
      (error.name === 'TimeoutError' || error.name === 'AbortError'))
  ) {
    return {
      status: 504,
      kind: 'timeout',
      retryable: true,
      error:
        'The AI service took too long to respond. Please try again — large or complex documents may need a second attempt.',
    };
  }

  // ── A missing runtime global means a broken build/package, not bad input.
  //    Saying so plainly is the difference between a two-minute fix and a
  //    week of guessing (this is how the packaged app's Path2D bug presented).
  if (error instanceof ReferenceError) {
    return {
      status: 500,
      kind: 'runtime_missing_global',
      retryable: false,
      error: `The app is missing a component it needs at runtime (${raw}). This is a build or installation problem, not a problem with your document — please report it with the reference below.`,
    };
  }
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(raw)) {
    return {
      status: 500,
      kind: 'runtime_missing_module',
      retryable: false,
      error:
        'The app could not load one of its own components. This is an installation problem — please reinstall, and report it with the reference below if it persists.',
    };
  }

  // ── Model output we could not use ───────────────────────────────────────
  if (/Empty response|Failed to parse|JSON/i.test(raw)) {
    return {
      status: 502,
      kind: 'bad_model_output',
      retryable: true,
      error:
        'The AI returned a response the app could not read. Please try again; if it keeps happening, the document may be too large or unclear.',
    };
  }

  return {
    status: 500,
    kind: 'unexpected',
    retryable: true,
    error:
      'Something went wrong while processing this request. The details have been written to the log — see Settings → Diagnostics, and quote the reference below.',
  };
}

/**
 * Turn an internal error into a client response, and log the full detail.
 *
 * The response carries a `reference` that is also in the log line, so a user can
 * read out eight characters and the operator can find the exact failure.
 * `scope` should name the route, e.g. 'api/analyze'.
 */
export function safeErrorResponse(
  error: unknown,
  headers?: HeadersInit,
  scope = 'api'
): NextResponse {
  const ref = newRef();
  const c = classify(error);

  logRuntimeOnce();
  log.error(
    scope,
    `request failed (${c.kind})`,
    {
      responseStatus: c.status,
      kind: c.kind,
      retryable: c.retryable,
      ...(error instanceof ProviderHttpError
        ? {
            providerStatus: error.status,
            providerCode: error.providerCode,
            providerMessage: error.providerMessage,
          }
        : {}),
      ...describeError(error),
    },
    ref
  );

  return NextResponse.json(
    {
      error: c.error,
      kind: c.kind,
      reference: ref,
      retryable: c.retryable,
      ...(c.isRateLimit ? { isRateLimit: true } : {}),
    },
    { status: c.status, headers }
  );
}

/**
 * Wrap a route handler with start/finish logging.
 *
 * Every request gets a line on entry and a line on exit with its status and
 * duration, so the log shows what the app was doing before a failure — not just
 * the failure. Nothing about the request body is logged beyond its declared size.
 */
export function withApiLogging<T extends unknown[]>(
  scope: string,
  handler: (request: NextRequest, ...rest: T) => Promise<Response>
): (request: NextRequest, ...rest: T) => Promise<Response> {
  return async (request: NextRequest, ...rest: T) => {
    logRuntimeOnce();
    const started = Date.now();
    const contentLength = request.headers.get('content-length');

    log.debug(scope, 'request started', {
      method: request.method,
      bytes: contentLength ? Number(contentLength) : undefined,
    });

    try {
      const response = await handler(request, ...rest);
      const ms = Date.now() - started;
      const fields = { status: response.status, ms };
      if (response.status >= 400)
        log.warn(scope, 'request finished with an error status', fields);
      else log.info(scope, 'request finished', fields);
      return response;
    } catch (error) {
      // A throw that escaped the handler's own try/catch. Log it here so it can
      // never vanish, then let it propagate to Next's error handling.
      log.error(scope, 'handler threw outside its error handling', {
        ms: Date.now() - started,
        ...describeError(error),
      });
      throw error;
    }
  };
}
