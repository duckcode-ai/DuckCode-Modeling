import React from "react";

/**
 * SVG crow's-foot marker definitions shared across all React Flow edges.
 *
 * Why a single-mount defs block: markers registered via `<defs><marker id="…">`
 * can be referenced from anywhere in the document with `url(#id)`. React Flow
 * edges pass `markerEnd: "url(#…)"` and the SVG renderer looks up the id from
 * whichever `<defs>` is in scope. Mounting this component once at the canvas
 * root makes the markers visible to every edge without per-edge defs.
 *
 * Each end of a relationship has two independent dimensions:
 *   - cardinality: "one" | "many"
 *   - optionality: "mandatory" | "optional"
 *
 * Visual language (matches ISO crow's-foot notation):
 *   - one          → single perpendicular bar
 *   - many         → three-pronged crow's foot (crow-foot in name only — they point outward)
 *   - mandatory    → extra perpendicular bar on the inner side
 *   - optional     → open circle on the inner side
 *
 * Combinations:
 *   - one-mandatory      → ‖  (two inner bars)
 *   - one-optional       → ○| (circle + bar)
 *   - many-mandatory     → »|  (crow foot + bar)
 *   - many-optional      → »○ (crow foot + circle)
 *
 * Markers are defined for both ends (start of edge + end of edge). React Flow
 * flips coordinates automatically via `orient="auto"`.
 */

const MARKER_SIZE = 26;
const STROKE = 1.8;
// `context-stroke` makes the marker inherit the edge's stroke color automatically.
const STROKE_COLOR = "context-stroke";
const FILL_CANVAS = "var(--color-bg-canvas, #ffffff)";

function MarkerEnd({ id, children }) {
  return (
    <marker
      id={id}
      viewBox="-16 -8 22 16"
      refX={0}
      refY={0}
      markerWidth={MARKER_SIZE}
      markerHeight={MARKER_SIZE}
      markerUnits="userSpaceOnUse"
      orient="auto"
    >
      {children}
    </marker>
  );
}

function MarkerStart({ id, children }) {
  return (
    <marker
      id={id}
      viewBox="0 -8 22 16"
      refX={0}
      refY={0}
      markerWidth={MARKER_SIZE}
      markerHeight={MARKER_SIZE}
      markerUnits="userSpaceOnUse"
      orient="auto"
    >
      {/* start markers are flipped in x so the inner side faces the edge */}
      <g transform="scale(-1, 1)">{children}</g>
    </marker>
  );
}

/* ── Shape primitives — rendered with currentColor so edges tint them ── */

// The crow's foot: three short strokes spreading outward.
function CrowFoot() {
  return (
    <g stroke={STROKE_COLOR} strokeWidth={STROKE} fill="none" strokeLinecap="round">
      <path d="M0 0 L-10 -6" />
      <path d="M0 0 L-10 0" />
      <path d="M0 0 L-10 6" />
    </g>
  );
}

// Perpendicular bar (the "one" side).
function OneBar({ x = -6 }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={-6}
      y2={6}
      stroke={STROKE_COLOR}
      strokeWidth={STROKE}
      strokeLinecap="round"
    />
  );
}

// Open circle (the "optional" side).
function OptionalCircle({ cx = -9 }) {
  return (
    <circle
      cx={cx}
      cy={0}
      r={3.5}
      stroke={STROKE_COLOR}
      strokeWidth={STROKE}
      fill={FILL_CANVAS}
    />
  );
}

/* ── End-side markers (edge arrives at target) ── */

function OneMandatoryEnd({ id }) {
  return (
    <MarkerEnd id={id}>
      <g>
        <OneBar x={-3} />
        <OneBar x={-8} />
      </g>
    </MarkerEnd>
  );
}

function OneOptionalEnd({ id }) {
  return (
    <MarkerEnd id={id}>
      <g>
        <OneBar x={-3} />
        <OptionalCircle cx={-9} />
      </g>
    </MarkerEnd>
  );
}

function ManyMandatoryEnd({ id }) {
  return (
    <MarkerEnd id={id}>
      <g>
        <OneBar x={-2} />
        <g transform="translate(-3 0)">
          <CrowFoot />
        </g>
      </g>
    </MarkerEnd>
  );
}

function ManyOptionalEnd({ id }) {
  return (
    <MarkerEnd id={id}>
      <g>
        <OptionalCircle cx={-3} />
        <g transform="translate(-5 0)">
          <CrowFoot />
        </g>
      </g>
    </MarkerEnd>
  );
}

/* ── Start-side markers (edge leaves source) ── */

function OneMandatoryStart({ id }) {
  return (
    <MarkerStart id={id}>
      <g>
        <OneBar x={-3} />
        <OneBar x={-8} />
      </g>
    </MarkerStart>
  );
}

function OneOptionalStart({ id }) {
  return (
    <MarkerStart id={id}>
      <g>
        <OneBar x={-3} />
        <OptionalCircle cx={-9} />
      </g>
    </MarkerStart>
  );
}

function ManyMandatoryStart({ id }) {
  return (
    <MarkerStart id={id}>
      <g>
        <OneBar x={-2} />
        <g transform="translate(-3 0)">
          <CrowFoot />
        </g>
      </g>
    </MarkerStart>
  );
}

function ManyOptionalStart({ id }) {
  return (
    <MarkerStart id={id}>
      <g>
        <OptionalCircle cx={-3} />
        <g transform="translate(-5 0)">
          <CrowFoot />
        </g>
      </g>
    </MarkerStart>
  );
}

/** Canonical marker ids. Keep in sync with modelToFlow.js (pickCrowsFootMarkers). */
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

export default function CrowsFootMarkers() {
  const { end, start } = CROW_FOOT_MARKER_IDS;
  return (
    <svg
      aria-hidden="true"
      style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
    >
      <defs>
        <OneMandatoryEnd id={end.one_mandatory} />
        <OneOptionalEnd id={end.one_optional} />
        <ManyMandatoryEnd id={end.many_mandatory} />
        <ManyOptionalEnd id={end.many_optional} />
        <OneMandatoryStart id={start.one_mandatory} />
        <OneOptionalStart id={start.one_optional} />
        <ManyMandatoryStart id={start.many_mandatory} />
        <ManyOptionalStart id={start.many_optional} />
      </defs>
    </svg>
  );
}
