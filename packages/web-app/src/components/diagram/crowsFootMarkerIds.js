/* Pure helpers extracted from CrowsFootMarkers.jsx so Node's ESM test
   runner (no JSX transform) can import them without pulling in the
   React component tree. Keep this file JSX-free and framework-free. */

export const CROW_FOOT_MARKER_IDS = {
  end: {
    one_mandatory: "dl-cf-end-one-m",
    one_optional: "dl-cf-end-one-o",
    many_mandatory: "dl-cf-end-many-m",
    many_optional: "dl-cf-end-many-o",
  },
  start: {
    one_mandatory: "dl-cf-start-one-m",
    one_optional: "dl-cf-start-one-o",
    many_mandatory: "dl-cf-start-many-m",
    many_optional: "dl-cf-start-many-o",
  },
};

/**
 * Map a relationship's cardinality (+ per-end optionality) to the correct
 * (markerStart, markerEnd) pair. Designed to be called from modelToFlow.
 *
 * Defaults: source optionality = mandatory (primary-side), target optionality
 * inferred from the FK nullability if available, otherwise mandatory.
 */
export function pickCrowsFootMarkers({
  cardinality = "one_to_many",
  sourceOptional = false,
  targetOptional = false,
} = {}) {
  const normalized = String(cardinality).toLowerCase();
  const sourceEnd =
    normalized === "many_to_one" || normalized === "many_to_many" ? "many" : "one";
  const targetEnd =
    normalized === "one_to_many" || normalized === "many_to_many" ? "many" : "one";

  const sourceKey = `${sourceEnd}_${sourceOptional ? "optional" : "mandatory"}`;
  const targetKey = `${targetEnd}_${targetOptional ? "optional" : "mandatory"}`;

  return {
    markerStart: `url(#${CROW_FOOT_MARKER_IDS.start[sourceKey]})`,
    markerEnd: `url(#${CROW_FOOT_MARKER_IDS.end[targetKey]})`,
  };
}
