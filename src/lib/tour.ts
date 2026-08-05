/**
 * Guided UI tour (driver.js): step-by-step tooltips over the real interface,
 * with Next/Back navigation and a dimmed-overlay highlight per element.
 *
 * One step catalogue serves every screen state: steps anchor to [data-tour]
 * attributes and are filtered by what is actually visible when the tour
 * starts. On a fresh screen (no files) that yields upload/settings/theme; once
 * documents are loaded, the pipeline steps appear in the same walk order.
 * Replaying via the header "?" button therefore always tours the current UI.
 */
import { driver, type DriveStep } from 'driver.js';

const TUTORIAL_SEEN_KEY = 'tutorialSeen';

/** Full step catalogue, in walk order. */
const STEP_CATALOGUE: DriveStep[] = [
  {
    element: '[data-tour="upload"]',
    popover: {
      title: 'Add documents',
      description:
        'Drag & drop images, PDFs, or Word documents here — or click to browse. You can also drop an entire folder; in family mode, its subfolders become family members automatically.',
    },
  },
  {
    element: '[data-tour="client-name"]',
    popover: {
      title: 'Client name',
      description:
        "Enter the client's name — it appears in the report header and in the names of downloaded files.",
    },
  },
  {
    element: '[data-tour="file-list"]',
    popover: {
      title: 'Your documents',
      description:
        'Every uploaded file is listed here. Open a file to view it, set its language if auto-detection needs help, add per-document notes, or remove it.',
    },
  },
  {
    element: '[data-tour="family-panel"]',
    popover: {
      title: 'Family mode',
      description:
        "Turn this on when the documents belong to different family members. Fields are then compared only within each person's own documents, while shared facts (like parents' names) are cross-checked across members.",
    },
  },
  {
    element: '[data-tour="analysis-context"]',
    popover: {
      title: 'Tell the AI what to check',
      description:
        'Optional but powerful: describe what you want verified — for example "compare the father\'s name across all documents". Every request you write here gets an explicit answer in the report.',
    },
  },
  {
    element: '[data-tour="analyze-all"]',
    popover: {
      title: 'Run the analysis',
      description:
        'One click runs OCR, translation, and (in family mode) member and relationship detection for every document.',
    },
  },
  {
    element: '[data-tour="generate-report"]',
    popover: {
      title: 'Generate the report',
      description:
        'Builds the full discrepancy report — concordance table, per-document and cross-document findings, and the family cross-reference. Run it again after reviewing members or relationships.',
    },
  },
  {
    element: '[data-tour="fresh-report"]',
    popover: {
      title: 'Added more documents?',
      description:
        'This analyzes the new uploads and rebuilds the report so nothing is left out. Already-processed documents are read from the cache, not re-billed.',
    },
  },
  {
    element: '[data-tour="settings"]',
    popover: {
      title: 'Settings',
      description:
        'Configure the AI provider and API key, and clear cached results.',
    },
  },
  {
    element: '[data-tour="theme-toggle"]',
    popover: {
      title: 'Light / dark mode',
      description: 'Switch the interface theme.',
    },
  },
];

/** True when the selector matches a rendered element with actual size —
 *  excludes empty wrapper divs around conditionally-rendered components
 *  (an empty block div still has width, so height must be checked too). */
function isVisible(selector: string): boolean {
  const el = document.querySelector(selector);
  return (
    el instanceof HTMLElement && el.offsetWidth > 0 && el.offsetHeight > 0
  );
}

/** Start the tour over whatever is currently on screen. */
export function startTour(): void {
  const steps = STEP_CATALOGUE.filter(
    s => typeof s.element === 'string' && isVisible(s.element)
  );
  if (steps.length === 0) return;

  const hasPipeline = isVisible('[data-tour="analyze-all"]');
  // Closing step has no element — driver.js centers it on screen.
  steps.push({
    popover: {
      title: hasPipeline ? "You're all set" : 'Upload documents to begin',
      description: hasPipeline
        ? 'Replay this tour anytime with the ? button in the top-right corner.'
        : 'Once documents are uploaded, the analysis tools appear and this tour covers them too. Replay it anytime with the ? button in the top-right corner.',
    },
  });

  driver({
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    stagePadding: 6,
    popoverClass: 'brc-tour',
    steps,
  }).drive();
}

/**
 * Auto-start once per machine (the first launch after install). The seen-flag
 * is written before the tour runs, so closing it early never re-traps the
 * user on the next launch — the "?" button replays it on demand.
 */
export function maybeAutoStartTour(): void {
  try {
    if (localStorage.getItem(TUTORIAL_SEEN_KEY)) return;
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1');
  } catch {
    return; // storage unavailable — skip rather than auto-run every launch
  }
  // Let the first paint settle before measuring element positions.
  window.setTimeout(startTour, 800);
}
