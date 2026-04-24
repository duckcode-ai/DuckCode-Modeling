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

export const TOUR_VERSION = 2;
const STORAGE_KEY = "datalex.onboarding.seen";

/** The steps, in order. Each step is a driver.js PopoverStep. */
const TOUR_STEPS = [
  {
    popover: {
      title: "Welcome to DataLex",
      description:
        "DataLex is a git-native modeling workbench for conceptual, logical, and physical dbt-centered models. This tour walks through the icons and panels used to create, relate, validate, and save YAML assets.",
      side: "over",
      align: "center",
    },
  },
  {
    element: '[data-tour="import-dbt"]',
    popover: {
      title: "1 · Import dbt when you need physical models",
      description:
        "Start from a local dbt folder or a public git URL. DataLex keeps the original dbt YAML visible and creates a physical diagram you can use for table relationships, constraints, and SQL readiness.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="new-modeling-asset"]',
    popover: {
      title: "2 · Create by modeling layer",
      description:
        "The + button now asks for <strong>Conceptual</strong>, <strong>Logical</strong>, or <strong>Physical</strong>. New diagrams live under one shared home: <code>diagrams/&lt;layer&gt;/&lt;domain&gt;/...</code> inside the DataLex workspace.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="explorer-files"]',
    popover: {
      title: "3 · Explorer shows the real YAML tree",
      description:
        "Every file here is on disk. DataLex keeps diagrams together under <code>diagrams/</code>, models under <code>models/</code>, and generated SQL under <code>generated-sql/</code> so the repo stays predictable.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="workbench-studio"]',
    popover: {
      title: "4 · Work in the right layer mode",
      description:
        "The canvas toolbar changes by layer: conceptual adds business concepts, logical adds entities and keys, and physical opens dbt-backed table, constraint, and SQL workflows.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="add-entities"]',
    popover: {
      title: "5 · Compose diagrams from YAML",
      description:
        "In physical mode, drag dbt YAML from Explorer onto the diagram. In conceptual and logical modes, create diagram-first boxes and keep the business or logical design in the diagram YAML.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="add-relationship"]',
    popover: {
      title: "6 · Add relationships by layer",
      description:
        "Click <strong>Add Relationship</strong> or drag from a relationship handle. Conceptual relationships use business verbs, logical relationships capture roles and cardinality, and physical relationships capture dbt/database intent.",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="panel-tab-validation"]',
    popover: {
      title: "7 · Validate what matters for the layer",
      description:
        "Validation is layer-aware: conceptual checks definitions and domains, logical checks keys and unresolved types, and physical checks dbt YAML, SQL output, names, and relationship readiness.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="save-all"]',
    popover: {
      title: "8 · Save All, then review in Git",
      description:
        "Every edit is YAML on disk. Save All flushes the workbench, generated dbt assets, and diagram files so your next step is a normal Git diff and commit.",
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
