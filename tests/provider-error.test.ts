/**
 * readProviderError() extracts the provider's own diagnosis from an error
 * response without ever forwarding the body wholesale — the property that keeps
 * document content (which some endpoints echo) out of user-visible errors.
 */
import { describe, expect, it } from 'vitest';
import { ProviderHttpError, readProviderError } from '@/lib/provider-error';

const jsonResponse = (obj: unknown, status = 401) =>
  new Response(JSON.stringify(obj), { status });

describe('readProviderError', () => {
  it('reads the Azure error shape ({error:{code,message}})', async () => {
    const { code, message } = await readProviderError(
      jsonResponse({
        error: {
          code: '401',
          message: 'Access denied due to invalid subscription key',
        },
      })
    );
    expect(code).toBe('401');
    expect(message).toContain('invalid subscription key');
  });

  it('reads a flat {message} shape', async () => {
    const { message } = await readProviderError(
      jsonResponse({ message: 'model not found' })
    );
    expect(message).toBe('model not found');
  });

  it('discards non-JSON bodies rather than forwarding unknown text', async () => {
    const res = new Response('<html>gateway error page</html>', {
      status: 502,
    });
    expect(await readProviderError(res)).toEqual({});
  });

  it('discards non-string code/message values', async () => {
    const { code, message } = await readProviderError(
      jsonResponse({ error: { code: 401, message: { deep: 'object' } } })
    );
    expect(code).toBeUndefined();
    expect(message).toBeUndefined();
  });

  it('truncates very long provider messages', async () => {
    const { message } = await readProviderError(
      jsonResponse({ error: { message: 'x'.repeat(10_000) } })
    );
    expect(message!.length).toBeLessThanOrEqual(300);
  });

  it('tolerates an empty body', async () => {
    expect(await readProviderError(new Response('', { status: 500 }))).toEqual(
      {}
    );
  });
});

describe('ProviderHttpError', () => {
  it('flags config-problem statuses as non-retryable', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(new ProviderHttpError('openai', status).isConfigProblem).toBe(
        true
      );
    }
  });

  it('treats transient statuses as retryable', () => {
    for (const status of [429, 500, 502, 503]) {
      expect(new ProviderHttpError('openai', status).isConfigProblem).toBe(
        false
      );
    }
  });
});
