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

export const TOUR_VERSION = 5;
const STORAGE_KEY = "datalex.onboarding.seen";

/** The steps, in order. Each step is a driver.js PopoverStep. */
const TOUR_STEPS = [
  {
    popover: {
      title: "Welcome to DataLex",
      description:
        "DataLex helps teams turn dbt projects into governed, AI-ready analytics models.<br/><br/>The goal is better business meaning, stronger standards, and more accurate semantic and agentic analytics.",
      side: "over",
      align: "center",
    },
  },
  {
    popover: {
      title: "Problem · dbt lineage is not enough",
      description:
        "Current dbt projects often show SQL dependencies, but they miss the business concepts, relationship meaning, model grain, ownership, quality expectations, and governance context needed for trusted reuse.",
      side: "over",
      align: "center",
    },
  },
  {
    popover: {
      title: "Solution · DataLex adds the missing layer",
      description:
        "<ul><li>Connect business concepts to logical rules and physical dbt assets.</li><li>Review YAML standards before gaps spread.</li><li>Keep fixes reviewable through AI proposals and Git diffs.</li></ul>",
      side: "over",
      align: "center",
    },
  },
  {
    popover: {
      title: "Product demo · follow the working flow",
      description:
        "Next, the tour walks through import, readiness review, modeling layers, relationships, validation, AI-assisted fixes, and saving approved YAML changes.",
      side: "over",
      align: "center",
    },
  },
  {
    element: '[data-tour="import-dbt"]',
    popover: {
      title: "1 · Import the dbt repo",
      description:
        "Import a local dbt folder or public Git repo. DataLex keeps the original YAML visible, indexes dbt context, and prepares the project for readiness review.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="explorer-files"]',
    popover: {
      title: "2 · See readiness on the same files",
      description:
        "Explorer is the working tree. YAML files show red, yellow, or green readiness so users review gaps where they already work, not in a separate dashboard.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="new-modeling-asset"]',
    popover: {
      title: "3 · Add modeling intent",
      description:
        "Create conceptual, logical, or physical assets when dbt YAML is not enough. Conceptual captures business meaning, logical captures reusable rules, and physical stays grounded in dbt.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="workbench-studio"]',
    popover: {
      title: "4 · Work in the right modeling mode",
      description:
        "Use conceptual mode for business language, logical mode for keys and rules, and physical mode for dbt-backed tables, constraints, tests, and SQL readiness.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="add-entities"]',
    popover: {
      title: "5 · Connect models to meaning",
      description:
        "Drag dbt YAML into physical diagrams, or create conceptual and logical boxes directly. The useful part is traceability from business concept to logical structure to dbt asset.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="add-relationship"]',
    popover: {
      title: "6 · Make relationships explicit",
      description:
        "dbt lineage shows dependencies, but not always business meaning. Add verbs, cardinality, and relationship tests so joins and answers are easier to explain.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="panel-tab-validation"]',
    popover: {
      title: "7 · Detect gaps before they spread",
      description:
        "Validation and readiness review explain what is missing and why it matters: definitions, domains, keys, types, tests, contracts, governance, and import health.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="save-all"]',
    popover: {
      title: "8 · Apply only reviewed changes",
      description:
        "AI can explain gaps and propose YAML fixes, but changes stay reviewable. Save All writes local YAML so teams can review the Git diff before merging.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: '[data-tour="settings"]',
    popover: {
      title: "You're ready",
      description:
        "You can replay this tour anytime from <strong>Settings → Replay onboarding tour</strong>.",
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
    onDestroyStarted: (_element, _step, context) => {
      // Driver.js calls this before it removes the overlay. If we do not
      // explicitly destroy here, the Finish / close action marks the tour
      // seen but leaves the final popover on screen.
      markTourSeen();
      if (typeof onDoneOrClose === "function") onDoneOrClose();
      context?.driver?.destroy();
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
