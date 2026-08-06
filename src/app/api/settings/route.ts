import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveReportMode } from '@/lib/report-mode';

/** Keys the UI is allowed to read/write. */
const ALLOWED_KEYS = [
  'AI_PROVIDER',
  'GPT4O_ENDPOINT',
  'GPT4O_API_KEY',
  'GPT4O_DEPLOYMENT',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'OLLAMA_REASONING_MODEL',
  'REPORT_MODE',
] as const;

/**
 * Report mode used to be stored as NEXT_PUBLIC_REPORT_MODE, which Next.js bakes
 * into the client bundle at build time — so the saved value never took effect.
 * The setting is now plain REPORT_MODE, read server-side. Existing .env files
 * still carry the old key, so migrate it instead of stranding the user's choice.
 */
const LEGACY_REPORT_MODE_KEY = 'NEXT_PUBLIC_REPORT_MODE';

function migrateLegacyKeys(entries: Record<string, string>): void {
  const legacy = entries[LEGACY_REPORT_MODE_KEY];
  if (legacy && !entries.REPORT_MODE) entries.REPORT_MODE = legacy;
  delete entries[LEGACY_REPORT_MODE_KEY];
}

/** Resolve the .env file path — CONFIG_DIR is set by Electron, otherwise
 *  fall back to the project root (dev mode). */
function envFilePath(): string {
  const dir = process.env.CONFIG_DIR || process.cwd();
  return path.join(dir, '.env');
}

/** Placeholder values seeded from .env.example must read as "not configured". */
const PLACEHOLDER_RE = /your-.+-here/i;

/**
 * Reject requests that did not come from the app itself. The server binds to
 * loopback, but a page in the user's regular browser can still reach it:
 * cross-site via a no-preflight text/plain form POST (CSRF), or same-origin
 * via DNS rebinding (Host = attacker domain resolving to 127.0.0.1). The
 * hostname check defeats rebinding; the custom header — which a cross-origin
 * page cannot send without a CORS preflight that would fail — defeats CSRF on
 * the state-changing POST. Returns a 403 response, or null to proceed.
 */
function foreignRequestGuard(
  req: NextRequest,
  requireAppHeader: boolean
): NextResponse | null {
  const hostname = (req.headers.get('host') ?? '')
    .replace(/:\d+$/, '')
    .toLowerCase();
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (requireAppHeader && req.headers.get('x-brc-app') !== '1') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
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
  // Keys outside the allowlist (e.g. GPT4O_MAX_OUTPUT_TOKENS set directly in
  // the file by an operator) must survive a Settings save, not be deleted.
  const allowed = new Set<string>(ALLOWED_KEYS);
  const extraKeys = Object.keys(entries).filter(k => !allowed.has(k));
  if (extraKeys.length > 0) {
    lines.push('', '# Other keys (preserved from the existing file)');
    for (const key of extraKeys) {
      lines.push(`${key}=${entries[key]}`);
    }
  }
  return lines.join('\n') + '\n';
}

// ── GET: return current settings (mask the API key) ────────────────────

export async function GET(req: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: 'Settings API is disabled on Vercel.' },
      { status: 403 },
    );
  }
  const forbidden = foreignRequestGuard(req, false);
  if (forbidden) return forbidden;

  const env = parseEnvFile(envFilePath());
  migrateLegacyKeys(env);

  // Build response — never reveal any characters of a secret key (a fixed
  // placeholder + the `configured` map below is all the UI needs). A seeded
  // placeholder key must show as NOT set, or first-run users see masked dots
  // for a key that doesn't work.
  const settings: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) {
    const val = env[key] ?? process.env[key] ?? '';
    if (key.endsWith('_KEY')) {
      settings[key] = val && !PLACEHOLDER_RE.test(val) ? '••••••••' : '';
    } else {
      settings[key] = val;
    }
  }

  // Report mode always has an effective value even when unset (it depends on
  // whether this is the desktop app or a web deployment), so report what the
  // pipeline will actually do rather than an empty dropdown.
  if (!settings.REPORT_MODE) settings.REPORT_MODE = resolveReportMode();

  // Also send the raw (unmasked) key presence so the UI knows if it's set.
  const configured: Record<string, boolean> = {};
  for (const key of ALLOWED_KEYS) {
    const val = env[key] ?? process.env[key] ?? '';
    configured[key] = !!val && !(key.endsWith('_KEY') && PLACEHOLDER_RE.test(val));
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
  const forbidden = foreignRequestGuard(req, true);
  if (forbidden) return forbidden;

  let body: Record<string, string>;
  try {
    body = (await req.json()) as Record<string, string>;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  // Read existing file first so we don't lose non-allowed keys/comments.
  const existing = parseEnvFile(envFilePath());
  // Fold the old NEXT_PUBLIC_REPORT_MODE into REPORT_MODE and drop it, so the
  // saved file has exactly one report-mode key.
  migrateLegacyKeys(existing);

  // Merge incoming values (only allowed keys), validating before persisting so
  // a malformed URL can't repoint server-side requests (SSRF) or break config.
  const URL_KEYS = new Set(['GPT4O_ENDPOINT', 'OLLAMA_BASE_URL']);
  const errors: string[] = [];
  for (const key of ALLOWED_KEYS) {
    if (!(key in body)) continue;
    const val = String(body[key]).trim();
    // If the UI sent back a masked value, don't overwrite the real key.
    if (val.includes('••••')) continue;

    if (key === 'AI_PROVIDER' && val && !['openai', 'ollama'].includes(val.toLowerCase())) {
      errors.push('AI_PROVIDER must be "openai" or "ollama".');
      continue;
    }
    if (key === 'REPORT_MODE' && val && !['light', 'deep'].includes(val.toLowerCase())) {
      errors.push('REPORT_MODE must be "light" or "deep".');
      continue;
    }
    if (URL_KEYS.has(key) && val) {
      try {
        const u = new URL(val);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
      } catch {
        errors.push(`${key} must be a valid http(s) URL.`);
        continue;
      }
    }
    existing[key] =
      key === 'AI_PROVIDER' || key === 'REPORT_MODE' ? val.toLowerCase() : val;
  }

  if (errors.length) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  // Write to disk.
  const envPath = envFilePath();
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, serialiseEnv(existing), 'utf-8');

  // Apply to the running process so the next API call uses new values — this is
  // what lets a Settings change (including report mode) take effect without
  // restarting the app.
  for (const key of ALLOWED_KEYS) {
    if (existing[key] !== undefined) {
      process.env[key] = existing[key];
    }
  }
  // Drop the migrated legacy key from the live environment too, so it cannot
  // linger and confuse a later read.
  delete process.env[LEGACY_REPORT_MODE_KEY];

  return NextResponse.json({ ok: true });
}
