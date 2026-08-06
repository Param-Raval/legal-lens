import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { withApiLogging } from '@/lib/api-guard';
import { recentLogText, redact } from '@/lib/logger';

// Never prerendered — the whole point is the state of this running process.
export const dynamic = 'force-dynamic';

/** Cap on characters returned, so a long-running session can't return megabytes. */
const MAX_CHARS = 200_000;

/**
 * Reject requests that did not come from the app itself — same reasoning as
 * /api/settings. The server binds to loopback, but a page in the user's normal
 * browser could still reach it cross-site or via DNS rebinding, and the log is
 * diagnostic information about this machine.
 */
function foreignRequestGuard(req: NextRequest): NextResponse | null {
  const hostname = (req.headers.get('host') ?? '')
    .replace(/:\d+$/, '')
    .toLowerCase();
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

/**
 * Return recent server log output for the Settings → Diagnostics panel.
 *
 * Two sources, both useful:
 *  - `session`: this process's in-memory ring buffer. Always available, including
 *    under `pnpm dev` where no log file exists.
 *  - `file`: `<CONFIG_DIR>/server.log`, which the Electron main process writes by
 *    piping the server's stdout/stderr. This is the one that survives a crash.
 *
 * Disabled on Vercel, where logs belong to the platform and the filesystem is
 * ephemeral.
 */
export const GET = withApiLogging('api/logs', async (req: NextRequest) => {
  if (process.env.VERCEL) {
    return NextResponse.json(
      {
        error:
          'Log viewing is disabled on Vercel — use the platform function logs instead.',
      },
      { status: 403 }
    );
  }
  const forbidden = foreignRequestGuard(req);
  if (forbidden) return forbidden;

  const session = recentLogText();

  const configDir = process.env.CONFIG_DIR;
  const logPath = configDir ? path.join(configDir, 'server.log') : null;
  const prevLogPath = configDir
    ? path.join(configDir, 'server.prev.log')
    : null;

  let file: string | null = null;
  let fileError: string | null = null;
  if (logPath) {
    try {
      const raw = fs.readFileSync(logPath, 'utf-8');
      file = raw.length > MAX_CHARS ? raw.slice(-MAX_CHARS) : raw;
      // The file is written by piping stdout, which the logger already redacts.
      // Redact again on the way out in case a dependency printed something raw.
      file = redact(file) as string;
    } catch (err) {
      fileError =
        (err as { code?: string }).code === 'ENOENT'
          ? 'No log file yet for this launch.'
          : 'Could not read the log file.';
    }
  }

  return NextResponse.json(
    {
      session,
      file,
      fileError,
      logPath,
      prevLogPath:
        prevLogPath && fs.existsSync(prevLogPath) ? prevLogPath : null,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
});
