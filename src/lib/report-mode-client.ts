/**
 * Client-side companion to src/lib/report-mode.ts.
 *
 * Kept in its own file so client code cannot accidentally import the server
 * resolver — in the browser `process.env` is an empty shim, so reading the mode
 * there always returns the default and silently ignores the user's choice.
 */
import type { ReportMode } from './report-mode';

/**
 * Ask the server which report mode is in effect right now.
 *
 * Deliberately not cached: the Settings dialog writes the new value to .env and
 * applies it to the running server process, so re-asking per report is what
 * makes a mode change take effect without restarting the app. Falls back to
 * "light" if the request fails, so a transient error degrades to the cheaper
 * pipeline rather than failing the report outright.
 */
export async function fetchReportMode(
  signal?: AbortSignal
): Promise<ReportMode> {
  try {
    const res = await fetch('/api/report-mode', { signal });
    if (!res.ok) return 'light';
    const { mode } = (await res.json()) as { mode?: string };
    return mode === 'deep' ? 'deep' : 'light';
  } catch (err) {
    // An aborted request means the user stopped the run; let the caller's
    // existing abort handling deal with it rather than reporting a mode.
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return 'light';
  }
}
