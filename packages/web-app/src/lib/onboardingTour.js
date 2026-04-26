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

export const TOUR_VERSION = 3;
const STORAGE_KEY = "datalex.onboarding.seen";

/** The steps, in order. Each step is a driver.js PopoverStep. */
const TOUR_STEPS = [
  {
    popover: {
      title: "Welcome to DataLex",
      description:
        "DataLex helps analytics teams turn dbt projects into governed, AI-ready models. The goal is not extra ceremony: it is clearer meaning, better metadata, earlier gap detection, and safer semantic/agentic analytics.",
      side: "over",
      align: "center",
    },
  },
  {
    element: '[data-tour="import-dbt"]',
    popover: {
      title: "1 · Start from the dbt repo",
      description:
        "Import a local dbt folder or public Git repo. DataLex keeps the YAML visible, indexes dbt context, and runs readiness review so missing descriptions, types, tests, ownership, and relationships are visible early.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="new-modeling-asset"]',
    popover: {
      title: "2 · Model by intent, not just files",
      description:
        "Create conceptual, logical, or physical assets when the repo needs more than raw dbt YAML. Conceptual captures business meaning, logical captures reusable rules, and physical stays grounded in dbt.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="explorer-files"]',
    popover: {
      title: "3 · Review the same YAML files",
      description:
        "Explorer is the working tree. Imported dbt/DataLex YAML files show readiness badges, so red/yellow/green status stays attached to the file users already need to fix.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="workbench-studio"]',
    popover: {
      title: "4 · Work in the right modeling mode",
      description:
        "The canvas changes by layer. Use conceptual mode for business language, logical mode for rules and keys, and physical mode for dbt-backed tables, constraints, tests, and SQL readiness.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="add-entities"]',
    popover: {
      title: "5 · Connect models to meaning",
      description:
        "Drag dbt YAML into physical diagrams, or create conceptual/logical boxes directly. The useful part is traceability: business concept to logical structure to physical dbt asset.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="add-relationship"]',
    popover: {
      title: "6 · Make relationships explicit",
      description:
        "Relationships are where AI and semantic layers often fail. Add business verbs, logical cardinality, and physical relationship tests so joins and answers are easier to explain.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="panel-tab-validation"]',
    popover: {
      title: "7 · Detect gaps before they spread",
      description:
        "Validation and dbt readiness review explain what is missing and why it matters: definitions, domains, keys, types, tests, contracts, governance, and import health.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="save-all"]',
    popover: {
      title: "8 · Apply only reviewed changes",
      description:
        "AI can explain gaps and propose YAML fixes, but changes stay reviewable. Save All writes local YAML so the next step is a normal Git diff and commit.",
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
