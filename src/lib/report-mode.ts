/**
 * Report-mode resolution. SERVER SIDE ONLY.
 *
 * Report mode decides whether the report pipeline makes one extra AI call per
 * document ("deep") or builds each document's summary from the OCR fields it
 * already has ("light").
 *
 * This MUST be resolved on the server. It used to be read in a client hook as
 * `process.env.NEXT_PUBLIC_REPORT_MODE`, but Next.js substitutes NEXT_PUBLIC_*
 * values into the client bundle at BUILD time — so the packaged desktop app was
 * frozen on whatever the value was when the installer was built (i.e. unset →
 * always "light"), and choosing Deep in Settings silently did nothing no matter
 * how many times the app was restarted. The client now asks the server for the
 * effective mode at report time via GET /api/report-mode, so a Settings change
 * applies to the very next report.
 *
 * Do not import this from a client component — `process.env` in the browser is
 * an empty shim and every lookup here would come back undefined.
 */

export type ReportMode = 'light' | 'deep';

/**
 * The mode used when nothing is configured.
 *
 * The desktop app defaults to "deep": it is an installed tool used by clinic
 * staff on one case at a time, where the richer per-document read is worth the
 * extra calls. A shared web deployment defaults to "light" so an unconfigured
 * public instance cannot fan out N AI calls per report.
 */
function defaultMode(): ReportMode {
  return process.env.BRC_DESKTOP === '1' ? 'deep' : 'light';
}

/**
 * Read the effective report mode from the environment.
 *
 * `NEXT_PUBLIC_REPORT_MODE` is accepted as a legacy alias: installs that saved
 * the old key into their .env keep working without the user touching Settings.
 */
export function resolveReportMode(): ReportMode {
  const raw = (
    process.env.REPORT_MODE ||
    process.env.NEXT_PUBLIC_REPORT_MODE ||
    ''
  )
    .trim()
    .toLowerCase();

  if (raw === 'deep') return 'deep';
  if (raw === 'light') return 'light';
  return defaultMode();
}
