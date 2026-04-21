/* Onboarding tour — thin wrapper around driver.js.
 *
 * Why driver.js: one tiny dep (~15KB gzipped) that gives us spotlight
 * overlay, tooltip positioning, keyboard nav, progress dots, and skip
 * buttons. We just declare the steps and which DOM targets they point
 * at; the library handles the rest.
 *
 * Targets are selected via `data-tour="<name>"` attributes so moving
 * buttons around in the DOM tree doesn't silently break the tour — the
 * steps keep finding their targets as long as the attribute moves
 * with the button.
 *
 * Storage key `datalex.onboarding.seen` records the version the user
 * dismissed — bumping TOUR_VERSION re-triggers the first-run modal
 * for existing users when we add new steps. */
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export const TOUR_VERSION = 1;
const STORAGE_KEY = "datalex.onboarding.seen";

/** The steps, in order. Each step is a driver.js PopoverStep. */
const TOUR_STEPS = [
  {
    popover: {
      title: "Welcome to DataLex",
      description:
        "DataLex is a git-native visual studio for dbt models. This 60-second tour walks through the icons and panels you'll use most. You can press <kbd>Esc</kbd> to skip at any point — it's always available from the Settings menu.",
      side: "over",
      align: "center",
    },
  },
  {
    element: '[data-tour="import-dbt"]',
    popover: {
      title: "1 · Import your dbt repo",
      description:
        "Start here. Paste a git URL, pick a local folder, or load the bundled jaffle-shop demo. Every model in <code>manifest.json</code> becomes a DataLex YAML entity — the Explorer on the left fills in immediately.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="explorer-files"]',
    popover: {
      title: "2 · The Explorer is your source of truth",
      description:
        "Every <code>.yml</code> you see is a real file on disk. Right-click any folder for <strong>New file</strong>, <strong>New folder</strong>, <strong>New diagram here…</strong>, rename, or delete — destructive actions show an impact preview before they cascade.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="new-diagram"]',
    popover: {
      title: "3 · Create a diagram",
      description:
        "Click the Layers icon to create a <code>.diagram.yaml</code> under <code>datalex/diagrams/</code>. A diagram is just a curated view over your models — you can have many, each with its own layout.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: '[data-tour="add-entities"]',
    popover: {
      title: "4 · Populate the canvas",
      description:
        "Open a diagram, click <strong>Add Entities</strong>, search / filter / multi-select across every model in the project. Entities auto-layout via ELK on add. Dragging a <code>schema.yml</code> straight onto the canvas works too.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="add-relationship"]',
    popover: {
      title: "5 · Wire up relationships",
      description:
        "Click <strong>Add Relationship</strong> or drag between the tiny column handles on two entities. Endpoints are validated against the resolved model graph — typos get an inline error, nothing writes until you confirm.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="panel-tab-validation"]',
    popover: {
      title: "6 · Validation + dangling scan",
      description:
        "The Validation panel aggregates every lint warning across the tree, grouped by file. If any relationship points at a missing entity or column, a red <strong>Dangling relationships</strong> banner lets you prune them in one click.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="save-all"]',
    popover: {
      title: "7 · Save All → git diff",
      description:
        "Every UI edit is merge-safe: shared <code>schema.yml</code> files route through the core-engine merge helper so sibling models aren't clobbered. Partial failures return a structured error listing exactly which files didn't land. Then just <code>git commit</code>.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: '[data-tour="settings"]',
    popover: {
      title: "You're ready",
      description:
        "You can replay this tour anytime from <strong>Settings → Replay onboarding tour</strong>. Full tutorials live under <code>docs/tutorials/</code> in the repo. Happy modeling.",
      side: "bottom",
      align: "end",
    },
  },
];

function buildDriver(onDoneOrClose) {
  return driver({
    showProgress: true,
    allowClose: true,
    overlayOpacity: 0.55,
    stagePadding: 4,
    stageRadius: 8,
    smoothScroll: true,
    popoverClass: "dl-tour-popover",
    progressText: "Step {{current}} of {{total}}",
    nextBtnText: "Next →",
    prevBtnText: "← Back",
    doneBtnText: "Finish",
    steps: TOUR_STEPS,
    onDestroyStarted: () => {
      // Fires on both Esc and the close X — mark as seen so we don't
      // nag the user again on refresh. If the user wants it back, the
      // Settings button spawns a fresh run.
      markTourSeen();
      if (typeof onDoneOrClose === "function") onDoneOrClose();
    },
  });
}

/** Start (or restart) the tour. Safe to call anywhere. */
export function startOnboardingTour(onDoneOrClose) {
  const d = buildDriver(onDoneOrClose);
  // Defer one tick so any newly-rendered targets (e.g. the Shell just
  // mounted) are definitely in the DOM before driver.js tries to
  // spotlight them.
  setTimeout(() => {
    try {
      d.drive();
    } catch (err) {
      // Driver.js throws if a selector doesn't resolve; log but don't
      // break the app — the tour is non-essential.
      console.warn("[onboarding] tour failed to start:", err);
      markTourSeen();
      if (typeof onDoneOrClose === "function") onDoneOrClose();
    }
  }, 80);
  return d;
}

/** True if we've never shown the first-run modal on this browser. */
export function shouldShowFirstRun() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    return (parsed?.version ?? 0) < TOUR_VERSION;
  } catch {
    return true;
  }
}

export function markTourSeen() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: TOUR_VERSION, at: new Date().toISOString() })
    );
  } catch {
    /* private mode / quota — ignore */
  }
}

/** Reset so the next page load shows the first-run modal again. */
export function resetOnboardingSeen() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
