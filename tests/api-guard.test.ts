/**
 * safeErrorResponse() is the single place internal failures become user-facing
 * messages. The bug this guards against: every provider failure used to
 * collapse into "Something went wrong… Please try again", so users retried an
 * invalid API key indefinitely. Each classification asserts three things:
 * the HTTP status, that the message tells the user what to DO, and that a
 * reference id links the response to the server log.
 */
import { describe, expect, it } from 'vitest';
import { enforceBodySize, safeErrorResponse } from '@/lib/api-guard';
import { ProviderHttpError } from '@/lib/provider-error';
import { NextRequest } from 'next/server';

async function body(res: Response) {
  return (await res.json()) as {
    error: string;
    kind: string;
    reference: string;
    retryable: boolean;
    isRateLimit?: boolean;
  };
}

describe('safeErrorResponse — provider HTTP errors', () => {
  it('401: names the problem, points to Settings, and is not retryable', async () => {
    const res = safeErrorResponse(
      new ProviderHttpError(
        'openai',
        401,
        '401',
        'Access denied due to invalid subscription key'
      )
    );
    const b = await body(res);
    expect(res.status).toBe(502);
    expect(b.kind).toBe('provider_auth');
    expect(b.retryable).toBe(false);
    expect(b.error).toContain('Settings');
    expect(b.error).toContain('401');
    // The provider's own diagnosis is platform text, not document content — it
    // must reach the user because it says exactly what is wrong.
    expect(b.error).toContain('invalid subscription key');
    expect(b.reference).toMatch(/^[0-9a-f]{8}$/);
  });

  it('404: points at the deployment name', async () => {
    const res = safeErrorResponse(new ProviderHttpError('openai', 404));
    const b = await body(res);
    expect(b.kind).toBe('provider_not_found');
    expect(b.retryable).toBe(false);
    expect(b.error).toContain('deployment');
  });

  it('429: keeps the isRateLimit contract the client retry loop depends on', async () => {
    const res = safeErrorResponse(new ProviderHttpError('openai', 429));
    const b = await body(res);
    expect(res.status).toBe(429);
    expect(b.isRateLimit).toBe(true);
    expect(b.retryable).toBe(true);
  });

  it('5xx: presented as temporary and retryable', async () => {
    const res = safeErrorResponse(new ProviderHttpError('openai', 503));
    const b = await body(res);
    expect(res.status).toBe(502);
    expect(b.kind).toBe('provider_unavailable');
    expect(b.retryable).toBe(true);
  });
});

describe('safeErrorResponse — string-based classification', () => {
  it('rate limit after exhausted retries (plain Error)', async () => {
    const res = safeErrorResponse(
      new Error(
        'Rate limited after multiple retries. Please wait a moment and try again.'
      )
    );
    const b = await body(res);
    expect(res.status).toBe(429);
    expect(b.isRateLimit).toBe(true);
  });

  it('content safety filter → 422, not retryable', async () => {
    const res = safeErrorResponse(
      new Error(
        'The request was blocked by the content safety filter and cannot be processed.'
      )
    );
    const b = await body(res);
    expect(res.status).toBe(422);
    expect(b.kind).toBe('content_filter');
    expect(b.retryable).toBe(false);
  });

  it('missing configuration → 503 naming the missing variable', async () => {
    const res = safeErrorResponse(
      new Error('GPT4O_API_KEY is not set. Configure it in Settings.')
    );
    const b = await body(res);
    expect(res.status).toBe(503);
    expect(b.kind).toBe('not_configured');
    expect(b.error).toContain('GPT4O_API_KEY');
  });

  it('timeout → 504 with a try-again framing', async () => {
    const res = safeErrorResponse(
      new Error('OpenAI request timed out. Please try again.')
    );
    const b = await body(res);
    expect(res.status).toBe(504);
    expect(b.kind).toBe('timeout');
  });

  it('unreachable provider → 503', async () => {
    const res = safeErrorResponse(
      new Error('Network error contacting OpenAI. Please try again.')
    );
    const b = await body(res);
    expect(res.status).toBe(503);
    expect(b.kind).toBe('provider_unreachable');
  });
});

describe('safeErrorResponse — broken build/runtime is not blamed on the user', () => {
  it('ReferenceError (the Path2D failure mode) says the app is broken, not the document', async () => {
    const res = safeErrorResponse(new ReferenceError('Path2D is not defined'));
    const b = await body(res);
    expect(b.kind).toBe('runtime_missing_global');
    expect(b.retryable).toBe(false);
    expect(b.error).toContain('Path2D is not defined');
    expect(b.error).not.toContain('Please try again');
  });

  it('missing module → installation problem', async () => {
    const res = safeErrorResponse(new Error("Cannot find module 'pdfjs-dist'"));
    const b = await body(res);
    expect(b.kind).toBe('runtime_missing_module');
    expect(b.retryable).toBe(false);
  });
});

describe('safeErrorResponse — fallback', () => {
  it('unknown errors still return a reference and point at Diagnostics', async () => {
    const res = safeErrorResponse(new Error('some totally novel failure'));
    const b = await body(res);
    expect(res.status).toBe(500);
    expect(b.kind).toBe('unexpected');
    expect(b.reference).toMatch(/^[0-9a-f]{8}$/);
    expect(b.error).toContain('reference');
  });

  it('never leaks a raw internal message in the fallback path', async () => {
    const res = safeErrorResponse(
      new Error('ENOENT C:\\secret\\internal\\path\\data.json')
    );
    const b = await body(res);
    expect(b.error).not.toContain('C:\\secret');
  });
});

describe('enforceBodySize', () => {
  const make = (bytes: number) =>
    new NextRequest('http://127.0.0.1/api/analyze', {
      method: 'POST',
      headers: { 'content-length': String(bytes) },
    });

  it('passes requests under the cap', () => {
    expect(enforceBodySize(make(1024), 15 * 1024 * 1024)).toBeNull();
  });

  it('rejects oversized requests with 413 and the limit in MB', async () => {
    const res = enforceBodySize(make(16 * 1024 * 1024), 15 * 1024 * 1024);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(413);
    const b = (await res!.json()) as { error: string };
    expect(b.error).toContain('15 MB');
  });
});
