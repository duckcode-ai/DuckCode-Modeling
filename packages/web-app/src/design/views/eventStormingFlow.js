/* EventStorming flow builder — pure function consumed by DocsView's
 * "EventStorming flow" section (Phase 4b). Filters a YAML doc's entities
 * down to the EventStorming-typed ones and groups them by type in
 * canonical Brandolini order:
 *
 *   actors → commands → aggregates → events → policies
 *
 * Within each group entities keep the order they appear in the YAML —
 * that's the order the modeler chose, which is usually the narrative
 * order they want the docs to read in. We deliberately don't sort
 * alphabetically; the YAML *is* the script.
 *
 * Returns an empty array when no EventStorming entities exist, so the
 * caller can render conditionally with a single `.length === 0` check.
 *
 * Shape:
 *   [{
 *     type:  "actor" | "command" | "aggregate" | "event" | "policy",
 *     label: "Actors" | "Commands" | ... ,         // pluralized heading
 *     items: entity[],                              // raw entity objects
 *   }]
 */

export const EVENTSTORMING_TYPES = ["actor", "command", "aggregate", "event", "policy"];

const GROUP_LABELS = {
  actor: "Actors",
  command: "Commands",
  aggregate: "Aggregates",
  event: "Events",
  policy: "Policies",
};

export function buildEventStormingFlow(entities) {
  if (!Array.isArray(entities) || entities.length === 0) return [];

  const buckets = new Map();
  for (const t of EVENTSTORMING_TYPES) buckets.set(t, []);

  for (const e of entities) {
    if (!e || typeof e !== "object") continue;
    const t = String(e.type || "").trim();
    if (buckets.has(t)) buckets.get(t).push(e);
  }

  const out = [];
  for (const t of EVENTSTORMING_TYPES) {
    const items = buckets.get(t);
    if (items.length === 0) continue;
    out.push({ type: t, label: GROUP_LABELS[t], items });
  }
  return out;
}
