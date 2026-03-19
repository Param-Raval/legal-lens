import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/** Keys the UI is allowed to read/write. */
const ALLOWED_KEYS = [
  'AI_PROVIDER',
  'GPT4O_ENDPOINT',
  'GPT4O_API_KEY',
  'GPT4O_DEPLOYMENT',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'OLLAMA_REASONING_MODEL',
] as const;

/** Resolve the .env file path — CONFIG_DIR is set by Electron, otherwise
 *  fall back to the project root (dev mode). */
function envFilePath(): string {
  const dir = process.env.CONFIG_DIR || process.cwd();
  return path.join(dir, '.env');
}

/** Minimal .env parser (same logic as Electron main). */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** Serialise key-value pairs back to a .env file. */
function serialiseEnv(entries: Record<string, string>): string {
  const lines: string[] = [
    '# BRC Assistant — Configuration',
    '# Saved by the in-app settings dialog.',
    '',
  ];
  for (const key of ALLOWED_KEYS) {
    const val = entries[key] ?? '';
    lines.push(`${key}=${val}`);
  }
  return lines.join('\n') + '\n';
}

// ── GET: return current settings (mask the API key) ────────────────────

export async function GET() {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: 'Settings API is disabled on Vercel.' },
      { status: 403 },
    );
  }

  const env = parseEnvFile(envFilePath());

  // Build response — mask secret keys, expose the rest.
  const settings: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) {
    const val = env[key] ?? process.env[key] ?? '';
    if (key.endsWith('_KEY') && val.length > 8) {
      settings[key] = val.slice(0, 4) + '••••' + val.slice(-4);
    } else {
      settings[key] = val;
    }
  }

  // Also send the raw (unmasked) key presence so the UI knows if it's set.
  const configured: Record<string, boolean> = {};
  for (const key of ALLOWED_KEYS) {
    configured[key] = !!(env[key] ?? process.env[key]);
  }

  return NextResponse.json({ settings, configured });
}

// ── POST: save settings to .env and apply to process.env ───────────────

export async function POST(req: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: 'Settings API is disabled on Vercel.' },
      { status: 403 },
    );
  }

  const body = (await req.json()) as Record<string, string>;

  // Read existing file first so we don't lose non-allowed keys/comments.
  const existing = parseEnvFile(envFilePath());

  // Merge incoming values (only allowed keys).
  for (const key of ALLOWED_KEYS) {
    if (key in body) {
      const val = String(body[key]).trim();
      // If the UI sent back a masked value, don't overwrite the real key.
      if (val.includes('••••')) continue;
      existing[key] = val;
    }
  }

  // Write to disk.
  const envPath = envFilePath();
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, serialiseEnv(existing), 'utf-8');

  // Apply to the running process so the next API call uses new values.
  for (const key of ALLOWED_KEYS) {
    if (existing[key] !== undefined) {
      process.env[key] = existing[key];
    }
  }

  return NextResponse.json({ ok: true });
}
