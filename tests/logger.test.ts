/**
 * The logger is the diagnostic channel for the packaged app, so its two safety
 * properties get pinned: secrets never reach a log line, and the in-memory ring
 * (which backs Settings → Diagnostics) records what was logged.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  describeError,
  log,
  newRef,
  recentLogs,
  recentLogText,
  redact,
} from '@/lib/logger';

const KEY = 'GPT4O_API_KEY';
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env[KEY];
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY];
  else process.env[KEY] = savedKey;
});

describe('redact', () => {
  it('scrubs the API key value out of strings', () => {
    process.env[KEY] = 'sk-super-secret-value-123456';
    expect(redact('auth failed for key sk-super-secret-value-123456!')).toBe(
      `auth failed for key [redacted:${KEY}]!`
    );
  });

  it('scrubs recursively through fields', () => {
    process.env[KEY] = 'sk-super-secret-value-123456';
    const out = redact({
      msg: 'Bearer sk-super-secret-value-123456',
      nested: ['sk-super-secret-value-123456'],
    }) as { msg: string; nested: string[] };
    expect(out.msg).not.toContain('sk-super-secret');
    expect(out.nested[0]).not.toContain('sk-super-secret');
  });

  it('does not scrub when the key is too short to be a real credential', () => {
    // A 1-char "secret" would otherwise censor every occurrence of that char.
    process.env[KEY] = 'x';
    expect(redact('excellent xylophone')).toBe('excellent xylophone');
  });

  it('clamps very long strings', () => {
    const out = redact('a'.repeat(5000)) as string;
    expect(out.length).toBeLessThan(500);
    expect(out).toContain('5000 chars');
  });
});

describe('ring buffer', () => {
  it('records entries retrievable via recentLogs/recentLogText', () => {
    const marker = `marker-${newRef()}`;
    log.info('test-scope', marker, { n: 42 });
    const entries = recentLogs();
    expect(entries.some(e => e.message === marker)).toBe(true);
    expect(recentLogText()).toContain(marker);
    expect(recentLogText()).toContain('[test-scope]');
  });

  it('applies redaction before storing', () => {
    process.env[KEY] = 'sk-super-secret-value-123456';
    log.error('test-scope', 'failed with sk-super-secret-value-123456');
    expect(recentLogText()).not.toContain('sk-super-secret-value-123456');
  });
});

describe('newRef', () => {
  it('produces short unique hex ids', () => {
    const refs = new Set(Array.from({ length: 100 }, newRef));
    expect(refs.size).toBe(100);
    for (const r of refs) expect(r).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('describeError', () => {
  it('captures name, message, and a bounded stack', () => {
    const d = describeError(new TypeError('boom'));
    expect(d.errorName).toBe('TypeError');
    expect(d.errorMessage).toBe('boom');
    expect(String(d.stack)).toContain('boom');
  });

  it('surfaces cause and code (the undici fetch-failed shape)', () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    const d = describeError(new Error('fetch failed', { cause }));
    expect(d.cause).toContain('ECONNREFUSED');
    expect(d.causeCode).toBe('ECONNREFUSED');
  });

  it('handles non-Error throwables', () => {
    const d = describeError('string throw');
    expect(d.errorMessage).toBe('string throw');
  });
});
