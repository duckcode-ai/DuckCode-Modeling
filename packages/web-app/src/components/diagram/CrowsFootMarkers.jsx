import React from "react";
import { CROW_FOOT_MARKER_IDS, pickCrowsFootMarkers } from "./crowsFootMarkerIds.js";

// Re-export so existing consumers that import from this module (e.g.
// DiagramCanvas) continue to work while Node-side code imports the
// JSX-free helper module directly.
export { CROW_FOOT_MARKER_IDS, pickCrowsFootMarkers };

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

const MARKER_SIZE = 18;
const COLOR_DEFAULT = "#64748b"; // slate-500; edges paint over this via context-stroke
const STROKE = 1.6;

function MarkerEnd({ id, children }) {
  return (
    <marker
      id={id}
      viewBox="-12 -6 18 12"
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
      viewBox="0 -6 18 12"
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
    <g stroke="currentColor" strokeWidth={STROKE} fill="none" strokeLinecap="round">
      <path d="M0 0 L-9 -5" />
      <path d="M0 0 L-9 0" />
      <path d="M0 0 L-9 5" />
    </g>
  );
}

// Perpendicular bar (the "one" side).
function OneBar({ x = -6 }) {
  return (
    <line
      x1={x}
      x2={x}
      y1={-5}
      y2={5}
      stroke="currentColor"
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
      r={3}
      stroke="currentColor"
      strokeWidth={STROKE}
      fill="var(--color-bg-canvas, #ffffff)"
    />
  );
}

/* ── End-side markers (edge arrives at target) ── */

function OneMandatoryEnd({ id }) {
  return (
    <MarkerEnd id={id}>
      <g color={COLOR_DEFAULT}>
        <OneBar x={-3} />
        <OneBar x={-8} />
      </g>
    </MarkerEnd>
  );
}

function OneOptionalEnd({ id }) {
  return (
    <MarkerEnd id={id}>
      <g color={COLOR_DEFAULT}>
        <OneBar x={-3} />
        <OptionalCircle cx={-9} />
      </g>
    </MarkerEnd>
  );
}

function ManyMandatoryEnd({ id }) {
  return (
    <MarkerEnd id={id}>
      <g color={COLOR_DEFAULT}>
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
      <g color={COLOR_DEFAULT}>
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
      <g color={COLOR_DEFAULT}>
        <OneBar x={-3} />
        <OneBar x={-8} />
      </g>
    </MarkerStart>
  );
}

function OneOptionalStart({ id }) {
  return (
    <MarkerStart id={id}>
      <g color={COLOR_DEFAULT}>
        <OneBar x={-3} />
        <OptionalCircle cx={-9} />
      </g>
    </MarkerStart>
  );
}

function ManyMandatoryStart({ id }) {
  return (
    <MarkerStart id={id}>
      <g color={COLOR_DEFAULT}>
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
      <g color={COLOR_DEFAULT}>
        <OptionalCircle cx={-3} />
        <g transform="translate(-5 0)">
          <CrowFoot />
        </g>
      </g>
    </MarkerStart>
  );
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
