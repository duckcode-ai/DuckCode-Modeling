/* Onboarding journey — action-oriented first-run flow.
 *
 * Replaces the older welcome modal + 13-step driver.js spotlight tour
 * (which is still available as a "deep feature tour" from Settings).
 * The journey panel walks a new user through six concrete actions:
 * connect → review gaps → create entity → configure AI → ask AI to draw.
 *
 * Each step exposes:
 *   - id           stable string used as the storage key + completion lookup
 *   - title        single-line headline
 *   - body         one short paragraph (15px)
 *   - cta          button label
 *   - completeOn   event name (or null) that auto-marks the step done
 *
 * State persists in localStorage as
 *   { version, currentStep, completed: [stepIds], at }
 * `version` lets us re-trigger the journey for existing users when we add
 * or reorder steps (mirrors TOUR_VERSION on onboardingTour.js).
 */

export const JOURNEY_VERSION = 1;
const STORAGE_KEY = "datalex.onboarding.journey";

export const JOURNEY_STEPS = [
  {
    id: "welcome",
    title: "Welcome to DataLex",
    body:
      "Turn your dbt project into a governed, AI-ready model. Business meaning on top, dbt files underneath, reviewable diffs in between — every step lands as YAML in the repo your team already owns.",
    cta: "Let's go",
    completeOn: null,
  },
  {
    id: "connect",
    title: "Connect your project",
    body:
      "Point DataLex at a Git URL or a local dbt folder. Your YAML stays where it is — DataLex reads it in place, indexes the manifest, and surfaces gaps right next to the files.",
    cta: "Import a project",
    completeOn: "dbt:import:success",
  },
  {
    id: "gaps",
    title: "See what's missing",
    body:
      "Open the Validation drawer to see readiness scores per file — missing descriptions, unknown column types, missing tests, contracts, owners. This is exactly what the readiness gate enforces in CI.",
    cta: "Open Validation",
    completeOn: "validation:opened",
  },
  {
    id: "design",
    title: "Design your first business domain",
    body:
      "Click + to add a logical entity (with keys + attributes) or a physical entity (dbt-backed). Start with one core concept like Customer or Order — DataLex tracks it from concept to dbt asset.",
    cta: "Create entity",
    completeOn: "entity:created",
  },
  {
    id: "ai",
    title: "Add your AI provider",
    body:
      "DataLex's AI agents propose YAML fixes, draft conceptual models, and explain readiness gaps. Add an OpenAI / Anthropic / local-LLM key once and every agent picks it up.",
    cta: "Open AI settings",
    completeOn: "ai:settings:saved",
  },
  {
    id: "draw",
    title: "Ask AI to draw a diagram",
    body:
      "Now that you're connected and configured, let the Conceptualizer propose entities and relationships from your staging models in one click. You'll review the proposal before anything writes to YAML.",
    cta: "Propose conceptual diagram",
    completeOn: "ai:conceptualize:applied",
  },
];

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeState(state) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, version: JOURNEY_VERSION, at: new Date().toISOString() })
    );
  } catch {
    /* private mode / quota — ignore */
  }
}

/** Has this browser ever finished the journey at the current version? */
export function shouldShowJourney() {
  const s = readState();
  if (!s) return true;
  if ((s.version ?? 0) < JOURNEY_VERSION) return true;
  if (s.dismissed) return false;
  // Show until every step is in `completed`.
  const completed = Array.isArray(s.completed) ? s.completed : [];
  return completed.length < JOURNEY_STEPS.length;
}

export function getJourneyState() {
  const s = readState() || {};
  const completed = Array.isArray(s.completed) ? s.completed : [];
  // currentStep = first step not yet in completed; fall back to last step
  // index when everything is done.
  const firstIncomplete = JOURNEY_STEPS.findIndex((step) => !completed.includes(step.id));
  const currentIndex = firstIncomplete < 0 ? JOURNEY_STEPS.length - 1 : firstIncomplete;
  return {
    completed,
    currentIndex,
    currentStep: JOURNEY_STEPS[currentIndex] || null,
    dismissed: !!s.dismissed,
  };
}

export function markStepComplete(stepId) {
  const s = readState() || {};
  const completed = Array.isArray(s.completed) ? [...s.completed] : [];
  if (!completed.includes(stepId)) completed.push(stepId);
  writeState({ ...s, completed });
}

export function dismissJourney({ markDone = false } = {}) {
  const s = readState() || {};
  const completed = markDone ? JOURNEY_STEPS.map((step) => step.id) : (s.completed || []);
  writeState({ ...s, completed, dismissed: true });
}

export function resetJourney() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/* ── Event bus ──────────────────────────────────────────────────────
 * The journey advances on app events ("the user just finished an
 * import", "the user saved an AI key", …). We use a tiny custom-event
 * bus on `window` rather than a Zustand store so any component — even
 * imperative code paths like dialog submit handlers — can fire an
 * event with one line and zero coupling. */

const EVENT_NAME = "datalex:onboarding";

export function emitJourneyEvent(name, detail = {}) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { name, ...detail } }));
  } catch {
    /* ignore */
  }
}

export function subscribeJourneyEvents(handler) {
  if (typeof window === "undefined") return () => {};
  const listener = (e) => handler(e.detail || {});
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
