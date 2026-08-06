/**
 * resolveReportMode() decides whether report generation makes one extra AI call
 * per document. The bug this guards against: the mode used to be read from a
 * NEXT_PUBLIC_* var in a client hook, which Next.js freezes at build time — the
 * installed app ignored the user's saved choice forever. The resolver must stay
 * server-side, read the environment at CALL time, and honour the legacy key.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveReportMode } from '@/lib/report-mode';

const KEYS = ['REPORT_MODE', 'NEXT_PUBLIC_REPORT_MODE', 'BRC_DESKTOP'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveReportMode', () => {
  it('defaults to light on a web deployment (nothing set)', () => {
    expect(resolveReportMode()).toBe('light');
  });

  it('defaults to deep in the desktop app (BRC_DESKTOP=1)', () => {
    process.env.BRC_DESKTOP = '1';
    expect(resolveReportMode()).toBe('deep');
  });

  it('honours an explicit REPORT_MODE over the desktop default', () => {
    process.env.BRC_DESKTOP = '1';
    process.env.REPORT_MODE = 'light';
    expect(resolveReportMode()).toBe('light');
  });

  it('reads the mode at call time, not module-load time', () => {
    expect(resolveReportMode()).toBe('light');
    process.env.REPORT_MODE = 'deep';
    // Same process, no reload — the change must be visible immediately, because
    // this is what makes a Settings save apply without an app restart.
    expect(resolveReportMode()).toBe('deep');
  });

  it('accepts the legacy NEXT_PUBLIC_REPORT_MODE key', () => {
    process.env.NEXT_PUBLIC_REPORT_MODE = 'deep';
    expect(resolveReportMode()).toBe('deep');
  });

  it('prefers REPORT_MODE when both keys are set', () => {
    process.env.NEXT_PUBLIC_REPORT_MODE = 'deep';
    process.env.REPORT_MODE = 'light';
    expect(resolveReportMode()).toBe('light');
  });

  it('is case- and whitespace-tolerant', () => {
    process.env.REPORT_MODE = '  DEEP ';
    expect(resolveReportMode()).toBe('deep');
  });

  it('falls back to the host default on an unrecognised value', () => {
    process.env.REPORT_MODE = 'turbo';
    expect(resolveReportMode()).toBe('light');
    process.env.BRC_DESKTOP = '1';
    expect(resolveReportMode()).toBe('deep');
  });

  it('treats an empty REPORT_MODE as unset', () => {
    process.env.BRC_DESKTOP = '1';
    process.env.REPORT_MODE = '';
    expect(resolveReportMode()).toBe('deep');
  });
});
