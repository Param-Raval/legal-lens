/**
 * /api/settings owns the .env file the desktop app runs on. Pinned behaviours:
 * the loopback + header guards (a browser tab must not be able to rewrite the
 * config), key masking (no secret characters in responses), the legacy
 * NEXT_PUBLIC_REPORT_MODE → REPORT_MODE migration, and preservation of
 * operator-added keys across saves.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/settings/route';

let tmpDir: string;
const ENV_KEYS = [
  'CONFIG_DIR',
  'VERCEL',
  'AI_PROVIDER',
  'GPT4O_API_KEY',
  'GPT4O_ENDPOINT',
  'GPT4O_DEPLOYMENT',
  'REPORT_MODE',
  'NEXT_PUBLIC_REPORT_MODE',
  'BRC_DESKTOP',
] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brc-settings-test-'));
  process.env.CONFIG_DIR = tmpDir;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const envPath = () => path.join(tmpDir, '.env');
const writeEnv = (content: string) => fs.writeFileSync(envPath(), content);

function getReq(host = '127.0.0.1:3456') {
  return new NextRequest('http://127.0.0.1:3456/api/settings', {
    headers: { host },
  });
}

function postReq(
  body: Record<string, string>,
  opts: { host?: string; appHeader?: boolean } = {}
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    host: opts.host ?? '127.0.0.1:3456',
  };
  if (opts.appHeader !== false) headers['x-brc-app'] = '1';
  return new NextRequest('http://127.0.0.1:3456/api/settings', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('GET /api/settings', () => {
  it('masks the API key — no secret characters in the response', async () => {
    writeEnv('GPT4O_API_KEY=sk-real-secret-key-abcdef\n');
    const res = await GET(getReq());
    const { settings } = (await res.json()) as {
      settings: Record<string, string>;
    };
    expect(settings.GPT4O_API_KEY).toBe('••••••••');
    expect(JSON.stringify(settings)).not.toContain('sk-real-secret');
  });

  it('treats a seeded placeholder key as not configured', async () => {
    writeEnv('GPT4O_API_KEY=your-azure-openai-api-key-here\n');
    const res = await GET(getReq());
    const { settings, configured } = (await res.json()) as {
      settings: Record<string, string>;
      configured: Record<string, boolean>;
    };
    expect(settings.GPT4O_API_KEY).toBe('');
    expect(configured.GPT4O_API_KEY).toBe(false);
  });

  it('reports the legacy NEXT_PUBLIC_REPORT_MODE value as REPORT_MODE', async () => {
    writeEnv('NEXT_PUBLIC_REPORT_MODE=deep\n');
    const res = await GET(getReq());
    const { settings } = (await res.json()) as {
      settings: Record<string, string>;
    };
    expect(settings.REPORT_MODE).toBe('deep');
    expect('NEXT_PUBLIC_REPORT_MODE' in settings).toBe(false);
  });

  it('always reports an effective report mode, even with an empty .env', async () => {
    writeEnv('');
    const res = await GET(getReq());
    const { settings } = (await res.json()) as {
      settings: Record<string, string>;
    };
    expect(['light', 'deep']).toContain(settings.REPORT_MODE);
  });

  it('rejects a non-loopback Host (DNS rebinding defence)', async () => {
    const res = await GET(getReq('evil.example.com'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/settings', () => {
  it('rejects a request without the x-brc-app header (CSRF defence)', async () => {
    const res = await POST(
      postReq({ REPORT_MODE: 'deep' }, { appHeader: false })
    );
    expect(res.status).toBe(403);
  });

  it('migrates the legacy key on save: file ends up with REPORT_MODE only', async () => {
    writeEnv('NEXT_PUBLIC_REPORT_MODE=deep\nGPT4O_MAX_OUTPUT_TOKENS=4096\n');
    const res = await POST(postReq({ AI_PROVIDER: 'openai' }));
    expect(res.status).toBe(200);
    const saved = fs.readFileSync(envPath(), 'utf-8');
    expect(saved).toContain('REPORT_MODE=deep');
    expect(saved).not.toContain('NEXT_PUBLIC_REPORT_MODE');
    // Operator-added keys outside the UI's allowlist must survive a save.
    expect(saved).toContain('GPT4O_MAX_OUTPUT_TOKENS=4096');
  });

  it('applies REPORT_MODE to the running process (no restart required)', async () => {
    writeEnv('');
    await POST(postReq({ REPORT_MODE: 'deep' }));
    expect(process.env.REPORT_MODE).toBe('deep');
  });

  it('does not overwrite the real key when the UI echoes the mask back', async () => {
    writeEnv('GPT4O_API_KEY=sk-real-secret-key-abcdef\n');
    await POST(postReq({ GPT4O_API_KEY: '••••••••' }));
    expect(fs.readFileSync(envPath(), 'utf-8')).toContain(
      'GPT4O_API_KEY=sk-real-secret-key-abcdef'
    );
  });

  it('rejects an invalid REPORT_MODE with 400', async () => {
    const res = await POST(postReq({ REPORT_MODE: 'turbo' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('REPORT_MODE');
  });

  it('rejects a non-http(s) endpoint URL (SSRF guard)', async () => {
    const res = await POST(postReq({ GPT4O_ENDPOINT: 'file:///etc/passwd' }));
    expect(res.status).toBe(400);
  });

  it('is disabled on Vercel', async () => {
    process.env.VERCEL = '1';
    const res = await POST(postReq({ REPORT_MODE: 'deep' }));
    expect(res.status).toBe(403);
  });
});
