/**
 * Structured server-side logging. SERVER ONLY.
 *
 * Why this exists: when the packaged desktop app failed, the only thing the user
 * saw was "Something went wrong while processing this request", and the only
 * server-side trace was a bare `console.error` with a minified stack. That is not
 * enough to diagnose anything. Every server-side log line now carries a
 * timestamp, level, scope, and — for anything tied to a request — a short
 * reference id that is ALSO returned to the client, so a user-visible error can
 * be matched to the exact log entry.
 *
 * Two destinations, both intentional:
 *  1. stdout / stderr — the Electron main process pipes these into
 *     `<userData>/server.log`, and Vercel collects them as function logs. No
 *     separate file writing here, so there is exactly one log file to reason
 *     about and no rotation logic to get wrong.
 *  2. An in-memory ring buffer — lets GET /api/logs show recent activity in the
 *     Settings → Diagnostics panel even in `pnpm dev`, where no server.log
 *     exists at all.
 *
 * PRIVACY: this log may be read by whoever has the machine, and may be pasted
 * into a bug report. Document text, extracted fields, and translations must
 * NEVER be logged — log sizes, counts, types, and durations instead. Values of
 * known-secret env vars are scrubbed defensively by `redact()` on the way out, in
 * case one ever reaches a message through an error string.
 */
import { randomBytes } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Env vars whose values must never appear in a log line. */
const SECRET_ENV_KEYS = ['GPT4O_API_KEY'];

/** Max characters of any single logged string value. */
const MAX_VALUE_CHARS = 400;

/** How many recent lines the Diagnostics panel can show. */
const RING_CAPACITY = 500;

export interface LogEntry {
  time: string;
  level: LogLevel;
  scope: string;
  message: string;
  /** Short id linking this entry to a client-visible error, when applicable. */
  ref?: string;
  fields?: Record<string, unknown>;
}

const ring: LogEntry[] = [];

function minLevel(): number {
  const raw = (process.env.LOG_LEVEL || '').trim().toLowerCase() as LogLevel;
  if (raw in LEVEL_ORDER) return LEVEL_ORDER[raw];
  return process.env.NODE_ENV === 'development'
    ? LEVEL_ORDER.debug
    : LEVEL_ORDER.info;
}

/**
 * Remove secret values and clamp long strings. Applied to every message and
 * every field value, so a secret leaking into an error message from any code
 * path still cannot reach the log file.
 */
export function redact(input: unknown): unknown {
  if (typeof input === 'string') {
    let out = input;
    for (const key of SECRET_ENV_KEYS) {
      const secret = process.env[key];
      // Only scrub values long enough to be a real credential — scrubbing a
      // 1-char value would replace every occurrence of that character.
      if (secret && secret.length >= 8) {
        out = out.split(secret).join(`[redacted:${key}]`);
      }
    }
    return out.length > MAX_VALUE_CHARS
      ? `${out.slice(0, MAX_VALUE_CHARS)}…(${out.length} chars)`
      : out;
  }
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = redact(v);
    }
    return out;
  }
  return input;
}

/** A short, human-quotable id (8 hex chars) used to tie a UI error to a log line. */
export function newRef(): string {
  return randomBytes(4).toString('hex');
}

function format(entry: LogEntry): string {
  const parts = [
    entry.time,
    entry.level.toUpperCase().padEnd(5),
    `[${entry.scope}]`,
  ];
  if (entry.ref) parts.push(`ref=${entry.ref}`);
  parts.push(entry.message);
  if (entry.fields && Object.keys(entry.fields).length > 0) {
    try {
      parts.push(JSON.stringify(entry.fields));
    } catch {
      parts.push('[unserialisable fields]');
    }
  }
  return parts.join(' ');
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  fields?: Record<string, unknown>,
  ref?: string
): void {
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    scope,
    message: redact(message) as string,
    ref,
    fields: fields ? (redact(fields) as Record<string, unknown>) : undefined,
  };

  // Ring buffer always receives the entry, even below the print threshold, so
  // Diagnostics can show detail that wasn't worth printing.
  ring.push(entry);
  if (ring.length > RING_CAPACITY) ring.shift();

  if (LEVEL_ORDER[level] < minLevel()) return;

  const line = format(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (scope: string, message: string, fields?: Record<string, unknown>) =>
    emit('debug', scope, message, fields),
  info: (scope: string, message: string, fields?: Record<string, unknown>) =>
    emit('info', scope, message, fields),
  warn: (scope: string, message: string, fields?: Record<string, unknown>) =>
    emit('warn', scope, message, fields),
  error: (
    scope: string,
    message: string,
    fields?: Record<string, unknown>,
    ref?: string
  ) => emit('error', scope, message, fields, ref),
};

/**
 * Describe an unknown thrown value for a log line: name, message, and stack.
 * Stack frames are kept because the whole point is diagnosing packaged builds,
 * where the failing line is otherwise unknowable.
 */
export function describeError(
  error: unknown,
  stackFrames = 6
): Record<string, unknown> {
  if (error instanceof Error) {
    const out: Record<string, unknown> = {
      errorName: error.name,
      errorMessage: error.message,
    };
    if (error.stack) {
      out.stack = error.stack
        .split('\n')
        .slice(0, stackFrames + 1)
        .map(l => l.trim())
        .join(' | ');
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      out.cause = `${cause.name}: ${cause.message}`;
      const code = (cause as { code?: string }).code;
      if (code) out.causeCode = code;
    }
    const code = (error as { code?: string }).code;
    if (code) out.code = code;
    return out;
  }
  return { errorName: typeof error, errorMessage: String(error) };
}

/** Recent log entries, oldest first. Used by GET /api/logs. */
export function recentLogs(limit = RING_CAPACITY): LogEntry[] {
  return ring.slice(-Math.max(1, Math.min(limit, RING_CAPACITY)));
}

/** Recent log entries as formatted text, ready to paste into a bug report. */
export function recentLogText(limit = RING_CAPACITY): string {
  return recentLogs(limit).map(format).join('\n');
}

/**
 * One-time snapshot of the runtime, logged at first server use. This is the
 * context that turns "it fails in the .exe but not in dev" from a mystery into a
 * two-minute diagnosis: whether we are inside Electron's utilityProcess, whether
 * the dependency tree is `node_modules` or the packaged `server_modules`, and
 * which provider is configured.
 */
let envLogged = false;

export function logRuntimeOnce(): void {
  if (envLogged) return;
  envLogged = true;

  const proc = process as NodeJS.Process & { type?: string };
  log.info('runtime', 'server runtime context', {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    nodeEnv: process.env.NODE_ENV,
    // The single most important line for packaged-app bugs: pdfjs (and other
    // libraries) disable their Node.js code paths when process.type is set,
    // which is exactly what happens inside Electron's utilityProcess.
    electron: process.versions.electron ?? null,
    processType: proc.type ?? null,
    isDesktop: process.env.BRC_DESKTOP === '1',
    isVercel: !!process.env.VERCEL,
    cwd: process.cwd(),
    provider: (process.env.AI_PROVIDER || 'openai').trim().toLowerCase(),
    hasApiKey: !!process.env.GPT4O_API_KEY,
    endpointHost: (() => {
      try {
        return new URL(process.env.GPT4O_ENDPOINT || '').host;
      } catch {
        return null;
      }
    })(),
    deployment: process.env.GPT4O_DEPLOYMENT || null,
    configDir: process.env.CONFIG_DIR || null,
  });
}
