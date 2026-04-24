/* Canvas — table cards + crow's foot relationships. Ported from DataLex design prototype. */
import React from "react";
import Icon from "./icons";
import { NOTATION, FK_COLOR_MAP } from "./notation";
import useUiStore from "../stores/uiStore";
import NodeErrorBoundary from "../components/shared/NodeErrorBoundary";
import { openRelationshipEditor } from "./relationshipEditor";
import { buildConceptualAreas, conceptualRelationshipLabel } from "../lib/conceptualModeling";

// Visual lexicon for the git-diff overlay (v0.4.2). Kept as a module
// constant so Legend / tests / future tooltip work can import the same
// colors without drifting. Matches the Pill palette in DiffToggle.jsx.
const DIFF_COLORS = {
  added:    { stroke: "#10b981", fill: "rgba(16,185,129,0.10)", label: "ADD", title: "Added since baseline" },
  modified: { stroke: "#f59e0b", fill: "rgba(245,158,11,0.10)", label: "MOD", title: "Modified since baseline" },
  removed:  { stroke: "#ef4444", fill: "rgba(239,68,68,0.10)",  label: "DEL", title: "Removed since baseline" },
};

const DEFAULT_WORLD_WIDTH = 2400;
const DEFAULT_WORLD_HEIGHT = 1600;
const WORLD_PADDING = 180;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.25;
const CONCEPT_CARD_WIDTH = 220;
const CONCEPT_CARD_HEIGHT = 128;

function isConceptTable(table, modelKind = "") {
  return String(modelKind || table?.modelKind || "").toLowerCase() === "conceptual"
    || String(table?.type || "").toLowerCase() === "concept";
}

function conceptualCardWidth(table) {
  const storedWidth = Number(table?.width);
  if (!Number.isFinite(storedWidth)) return CONCEPT_CARD_WIDTH;
  return Math.min(Math.max(storedWidth, 190), CONCEPT_CARD_WIDTH);
}

function estimateTableBounds(table, modelKind = "") {
  if (isConceptTable(table, modelKind)) {
    return { width: conceptualCardWidth(table), height: CONCEPT_CARD_HEIGHT };
  }
  const width = Number.isFinite(Number(table?.width)) ? Number(table.width) : 240;
  const rowCount = Array.isArray(table?.columns) ? table.columns.length : 0;
  const bodyHeight = Math.max(1, rowCount) * 26;
  const footerHeight = table?.kind === "ENUM" ? 0 : 28;
  return {
    width,
    height: 32 + bodyHeight + footerHeight + 12,
  };
}

function getWorldBounds(tables, modelKind = "") {
  if (!Array.isArray(tables) || tables.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: DEFAULT_WORLD_WIDTH,
      maxY: DEFAULT_WORLD_HEIGHT,
      width: DEFAULT_WORLD_WIDTH,
      height: DEFAULT_WORLD_HEIGHT,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;
  tables.forEach((table) => {
    const x = Number.isFinite(Number(table?.x)) ? Number(table.x) : 0;
    const y = Number.isFinite(Number(table?.y)) ? Number(table.y) : 0;
    const bounds = estimateTableBounds(table, modelKind);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + bounds.width);
    maxY = Math.max(maxY, y + bounds.height);
  });
  const paddedWidth = Math.max(DEFAULT_WORLD_WIDTH, maxX + WORLD_PADDING);
  const paddedHeight = Math.max(DEFAULT_WORLD_HEIGHT, maxY + WORLD_PADDING);
  return {
    minX: Number.isFinite(minX) ? minX : 0,
    minY: Number.isFinite(minY) ? minY : 0,
    maxX,
    maxY,
    width: paddedWidth,
    height: paddedHeight,
  };
}

function TableCard({ table, selected, onSelect, onMove, onMoveEnd, onStartConnect, diffStatus, zoom, modelKind }) {
  const I = Icon;
  const cardRef = React.useRef(null);
  const drag = React.useRef(null);
  const conceptual = isConceptTable(table, modelKind);
  const logical = String(modelKind || table?.modelKind || "").toLowerCase() === "logical";

  const hasValue = (value) => value != null && String(value).trim() !== "";

  const onMouseDown = (e) => {
    // Dragging from a column key dot or the card-level relationship handle
    // starts a relationship draw instead of a table move. Conceptual and
    // logical diagrams often need entity-level relationships, so the card
    // handle intentionally does not require a column endpoint.
    const keyEl = e.target.closest(".tc-key");
    const connectHandle = e.target.closest(".tc-connect-handle");
    if ((keyEl || connectHandle) && onStartConnect) {
      const row = keyEl?.closest(".tc-row");
      const colName = row?.getAttribute("data-col");
      e.preventDefault();
      e.stopPropagation();
      onStartConnect({ fromTable: table.id, fromColumn: colName || "" }, e);
      return;
    }
    if (e.target.closest(".tc-badges, button, .tc-colflags")) return;
    const rect = cardRef.current.getBoundingClientRect();
    drag.current = { dx: (e.clientX - rect.left) / zoom, dy: (e.clientY - rect.top) / zoom, moved: false };
    onSelect({ type: "table", id: table.id });
    const onMove2 = (ev) => {
      const parent = cardRef.current.parentElement.getBoundingClientRect();
      drag.current.moved = true;
      onMove(
        table.id,
        (ev.clientX - parent.left) / zoom - drag.current.dx,
        (ev.clientY - parent.top) / zoom - drag.current.dy,
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove2);
      window.removeEventListener("mouseup", onUp);
      const moved = !!drag.current?.moved;
      drag.current = null;
      // Only fire drag-end persistence when we actually moved — pure clicks
      // shouldn't rewrite YAML.
      if (moved && onMoveEnd) onMoveEnd(table.id);
    };
    window.addEventListener("mousemove", onMove2);
    window.addEventListener("mouseup", onUp);
  };

  const colFlags = (c) => {
    const flags = [];
    if (c.pk) flags.push({ k: "PK", I: I.Key, title: "PRIMARY KEY" });
    if (c.fk) flags.push({ k: "FK", I: I.Link, title: `FOREIGN KEY${c.fk ? ` → ${c.fk}` : ""}` });
    if (c.nn) flags.push({ k: "NN", I: I.NotNull, title: "NOT NULL" });
    if (c.unique && !c.pk) flags.push({ k: "UQ", I: I.Unique, title: "UNIQUE" });
    if (c.check) flags.push({ k: "CK", I: I.Check2, title: "CHECK: " + c.check });
    if (hasValue(c.default)) flags.push({ k: "DF", I: I.Default, title: "DEFAULT " + c.default });
    if (c.generated) flags.push({ k: "GN", I: I.Generated, title: "GENERATED" });
    return flags;
  };

  const diffTheme = diffStatus ? DIFF_COLORS[diffStatus] : null;
  // Apply the diff outline via inline style rather than a CSS class — the
  // overlay is dynamic and we don't want to ship a new stylesheet just for
  // three classes. The outline sits *outside* the existing selection ring
  // so users can see both selection + diff simultaneously.
  const diffStyle = diffTheme ? {
    outline: `2px solid ${diffTheme.stroke}`,
    outlineOffset: 2,
  } : null;
  const conceptDomain = table?.domain || table?.subject_area || table?.subject || "";
  const summaryBadges = conceptual
    ? [
        conceptDomain,
        table?.owner ? `owner ${table.owner}` : "",
      ].filter(Boolean)
    : [
        table?.type || table?.kind || (logical ? "logical" : "table"),
        table?.subject_area || table?.subject || "",
        table?.domain || "",
      ].filter(Boolean);
  const conceptPreview = [
    table?.description || "",
    Array.isArray(table?.terms) && table.terms.length ? `Terms: ${table.terms.slice(0, 2).join(", ")}` : "",
  ].filter(Boolean);
  const keySetCount = (value) => Array.isArray(value) ? value.length : 0;
  const keyBadges = logical ? [
    keySetCount(table?.candidate_keys) ? `${keySetCount(table.candidate_keys)} CK` : "",
    keySetCount(table?.alternate_keys) ? `${keySetCount(table.alternate_keys)} AK` : "",
    keySetCount(table?.business_keys) ? `${keySetCount(table.business_keys)} BK` : "",
    table?.surrogate_key ? "SK" : "",
    table?.natural_key ? "NK" : "",
    table?.hash_key ? "HK" : "",
    table?.subtype_of ? "Subtype" : "",
  ].filter(Boolean) : [];
  const physicalBadges = !conceptual && !logical ? [
    table?._sourceFile ? "dbt YAML" : "",
    table?.physical_name ? `physical: ${table.physical_name}` : "",
  ].filter(Boolean) : [];

  return (
    <div
      ref={cardRef}
      className={`table-card cat-${table.cat} ${conceptual ? "concept-card" : ""} ${selected ? "selected" : ""} ${table.junction ? "junction" : ""}`}
      id={`tc-${table.id}`}
      style={{ left: table.x, top: table.y, ...(conceptual ? { width: conceptualCardWidth(table) } : {}), ...(diffStyle || {}) }}
      onMouseDown={onMouseDown}
    >
      <div className="tc-header">
        {conceptual ? <I.Layers /> : table.kind === "ENUM" ? <I.Enum /> : table.junction ? <I.Junction /> : <I.Table />}
        <span className="tc-name">{table.name}</span>
        <span className="tc-schema">{conceptual ? "business" : logical ? "logical" : (table.schema || "dbt")}</span>
        <button
          type="button"
          className="tc-connect-handle"
          title={conceptual ? "Drag to another concept to define a business relationship" : logical ? "Drag to another entity to define a logical relationship" : "Drag to another table or column to define a physical relationship"}
          aria-label="Create relationship"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 20,
            height: 20,
            borderRadius: 6,
            border: "1px solid var(--border-default)",
            background: "var(--bg-1)",
            color: "var(--text-tertiary)",
            cursor: "crosshair",
            flexShrink: 0,
          }}
        >
          <I.Relation />
        </button>
        <div className="tc-badges">
          {diffTheme && (
            <span
              className="tc-badge"
              title={diffTheme.title}
              style={{
                border: `1px solid ${diffTheme.stroke}`,
                background: diffTheme.fill,
                color: diffTheme.stroke,
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >{diffTheme.label}</span>
          )}
          {!conceptual && (table.badges || []).map((b) => (
            <span key={b} className={`tc-badge ${b.toLowerCase()}`}>{b}</span>
          ))}
        </div>
      </div>
      {conceptual ? (
        <>
          <div className="concept-card-tags">
            {summaryBadges.slice(0, 2).map((badge) => (
              <span key={badge} className="concept-card-tag" title={badge}>{badge}</span>
            ))}
          </div>
          <div className="concept-card-body">
            {conceptPreview.length ? conceptPreview.slice(0, 2).map((line) => (
              <div key={line} className="concept-card-line" title={line}>
                {line}
              </div>
            )) : (
              <div className="concept-card-line muted">
                Add definition, owner, and terms in Details.
              </div>
            )}
          </div>
          <div className="tc-footer">
            <span>concept</span>
            <span>{conceptDomain || "unassigned"}</span>
          </div>
        </>
      ) : (
        <>
          {(keyBadges.length > 0 || physicalBadges.length > 0) && (
            <div style={{ padding: "8px 12px 4px", display: "flex", flexWrap: "wrap", gap: 5 }}>
              {[...keyBadges, ...physicalBadges].slice(0, 6).map((badge) => (
                <span
                  key={badge}
                  style={{
                    fontSize: 9.5,
                    padding: "2px 6px",
                    borderRadius: 999,
                    background: logical ? "rgba(8,145,178,0.12)" : "rgba(79,70,229,0.12)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          )}
          <div className="tc-rows">
            {table.columns.map((c) => {
              const isPk = c.pk;
              const isFk = !!c.fk || !!c.semanticFk;
              const flags = colFlags(c);
              return (
                <div key={c.name} className={`tc-row ${isPk ? "pk" : ""}`} data-col={c.name}>
                  <div className={`tc-key ${isPk ? "pk" : ""} ${isFk ? "fk" : ""}`}>
                    {isPk ? <I.Key /> : isFk ? <I.Link /> : (
                      <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--text-muted)" }} />
                    )}
                  </div>
                  <div className="tc-col">{c.name}</div>
                  <div className="tc-type">{c.type}</div>
                  <div className="tc-colflags">
                    {flags.map((f) => (
                      <span key={f.k} className={`tc-cf tc-cf-${f.k.toLowerCase()}`} title={f.title}>
                        <f.I />
                      </span>
                    ))}
                    {flags.length === 0 && (
                      <span className="tc-nn" title="No constraints">
                        ·
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {table.kind !== "ENUM" && (
            <div className="tc-footer">
              <span>{table.columns.length} {logical ? "attributes" : "columns"}</span>
              <span>{logical ? "platform-neutral" : (table._sourceFile ? table._sourceFile.split("/").pop() : table.rowCount || "physical")}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* Crow's-foot glyph drawer (IE notation) */
function drawEnd(x, y, side, spec, idPrefix, active, dimmed) {
  // Unspecified cardinality — render nothing. Upstream (`cardinalityToEnds`)
  // returns null for unknown strings so we land here with `max` undefined;
  // historically we silently defaulted to a crow's-foot, which lied to the
  // user. The main edge line is still drawn by the caller, so returning no
  // glyph is equivalent to a neutral "this edge has no cardinality" marker.
  if (!spec || (spec.max !== "N" && spec.max !== "1")) {
    return null;
  }
  const outward = {
    right:  { ux:  1, uy:  0 },
    left:   { ux: -1, uy:  0 },
    top:    { ux:  0, uy: -1 },
    bottom: { ux:  0, uy:  1 },
  }[side];
  const perp = { px: -outward.uy, py: outward.ux };
  const OPT_AT = 10, CARD_AT = 20, HALF_W = 6, CROW_W = 7, RAD = 3;
  const at = (d, w = 0) => [
    x + outward.ux * d + perp.px * w,
    y + outward.uy * d + perp.py * w,
  ];
  const lines = [];
  const circles = [];
  if (spec.max === "N") {
    const [ax, ay] = at(OPT_AT, 0);
    const [f1x, f1y] = at(CARD_AT, -CROW_W);
    const [f2x, f2y] = at(CARD_AT,  0);
    const [f3x, f3y] = at(CARD_AT,  CROW_W);
    lines.push({ k: `${idPrefix}-c1`, x1: ax, y1: ay, x2: f1x, y2: f1y });
    lines.push({ k: `${idPrefix}-c2`, x1: ax, y1: ay, x2: f2x, y2: f2y });
    lines.push({ k: `${idPrefix}-c3`, x1: ax, y1: ay, x2: f3x, y2: f3y });
  } else {
    const [a1x, a1y] = at(CARD_AT, -HALF_W);
    const [a2x, a2y] = at(CARD_AT,  HALF_W);
    lines.push({ k: `${idPrefix}-c1`, x1: a1x, y1: a1y, x2: a2x, y2: a2y });
  }
  if (spec.min === "0") {
    const [cx, cy] = at(OPT_AT - 3, 0);
    circles.push({ k: `${idPrefix}-o`, cx, cy, r: RAD });
  } else {
    const [a1x, a1y] = at(OPT_AT - 3, -HALF_W * 0.85);
    const [a2x, a2y] = at(OPT_AT - 3,  HALF_W * 0.85);
    lines.push({ k: `${idPrefix}-o`, x1: a1x, y1: a1y, x2: a2x, y2: a2y });
  }
  const cls = `rel-glyph ${active ? "active" : ""} ${dimmed ? "dimmed" : ""}`;
  return (
    <>
      {lines.map((l) => (
        <line key={l.k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className={cls} strokeLinecap="round" />
      ))}
      {circles.map((ci) => (
        <circle key={ci.k} cx={ci.cx} cy={ci.cy} r={ci.r} className={cls} fill="var(--bg-canvas)" strokeWidth="1.5" />
      ))}
    </>
  );
}

function Relationships({ tables, relationships, selected, onSelect, hovered, setHovered, width, height, zoom, stageRef, modelKind }) {
  const [anchors, setAnchors] = React.useState({});
  const openModal = useUiStore((s) => s.openModal);

  const recalc = React.useCallback(() => {
    const next = {};
    const inner = stageRef.current;
    if (!inner) return;
    const innerRect = inner.getBoundingClientRect();
    tables.forEach((t) => {
      const el = document.getElementById(`tc-${t.id}`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      next[t.id] = {
        x: (r.left - innerRect.left) / zoom,
        y: (r.top - innerRect.top) / zoom,
        w: r.width / zoom,
        h: r.height / zoom,
      };
      t.columns.forEach((c) => {
        const row = el.querySelector(`.tc-row[data-col="${c.name}"]`);
        if (!row) return;
        const rr = row.getBoundingClientRect();
        next[`${t.id}.${c.name}`] = { cy: (rr.top + rr.height / 2 - innerRect.top) / zoom };
      });
    });
    setAnchors(next);
  }, [stageRef, tables, zoom]);

  React.useEffect(() => { recalc(); }, [recalc]);
  React.useEffect(() => {
    const id = setInterval(recalc, 200);
    return () => clearInterval(id);
  }, [recalc]);

  const autoPorts = (fromEp, toEp) => {
    const A = anchors[fromEp.table], B = anchors[toEp.table];
    if (!A || !B) return null;
    const aColY = anchors[`${fromEp.table}.${fromEp.col}`]?.cy;
    const bColY = anchors[`${toEp.table}.${toEp.col}`]?.cy;
    const Acx = A.x + A.w / 2, Acy = A.y + A.h / 2;
    const Bcx = B.x + B.w / 2, Bcy = B.y + B.h / 2;
    const dx = Bcx - Acx, dy = Bcy - Acy;
    if (fromEp.table === toEp.table) {
      return {
        a: { x: A.x + A.w, y: aColY ?? Acy, side: "right" },
        b: { x: A.x + A.w, y: bColY ?? Acy, side: "right" },
        selfJoin: true,
      };
    }
    const horizontal = Math.abs(dx) > A.w * 0.35 || Math.abs(dx) > Math.abs(dy) * 0.8;
    let aSide, bSide;
    if (horizontal) {
      aSide = dx >= 0 ? "right" : "left";
      bSide = dx >= 0 ? "left"  : "right";
    } else {
      aSide = dy >= 0 ? "bottom" : "top";
      bSide = dy >= 0 ? "top"    : "bottom";
    }
    const portOf = (box, side, colY) => {
      if (side === "left")   return { x: box.x,           y: colY ?? (box.y + box.h / 2), side };
      if (side === "right")  return { x: box.x + box.w,   y: colY ?? (box.y + box.h / 2), side };
      if (side === "top")    return { x: box.x + box.w / 2, y: box.y,                     side };
      if (side === "bottom") return { x: box.x + box.w / 2, y: box.y + box.h,             side };
    };
    return {
      a: portOf(A, aSide, aSide === "left" || aSide === "right" ? aColY : null),
      b: portOf(B, bSide, bSide === "left" || bSide === "right" ? bColY : null),
      selfJoin: false,
    };
  };

  const path = (a, b, selfJoin) => {
    const pad = 22;
    const ax2 = a.side === "left" ? a.x - pad : a.side === "right" ? a.x + pad : a.x;
    const ay2 = a.side === "top"  ? a.y - pad : a.side === "bottom" ? a.y + pad : a.y;
    const bx2 = b.side === "left" ? b.x - pad : b.side === "right" ? b.x + pad : b.x;
    const by2 = b.side === "top"  ? b.y - pad : b.side === "bottom" ? b.y + pad : b.y;
    if (selfJoin) {
      const loopOut = 42;
      const sx = a.side === "right" ? a.x + loopOut : a.x - loopOut;
      return `M ${a.x} ${a.y} L ${sx} ${a.y} L ${sx} ${b.y} L ${b.x} ${b.y}`;
    }
    const aH = a.side === "left" || a.side === "right";
    const bH = b.side === "left" || b.side === "right";
    if (aH && bH) {
      const midX = (ax2 + bx2) / 2;
      return `M ${a.x} ${a.y} L ${ax2} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${bx2} ${b.y} L ${b.x} ${b.y}`;
    }
    if (!aH && !bH) {
      const midY = (ay2 + by2) / 2;
      return `M ${a.x} ${a.y} L ${a.x} ${ay2} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${by2} L ${b.x} ${b.y}`;
    }
    if (aH && !bH) return `M ${a.x} ${a.y} L ${ax2} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`;
    return `M ${a.x} ${a.y} L ${a.x} ${ay2} L ${a.x} ${b.y} L ${b.x} ${b.y}`;
  };

  return (
    <svg className="rel-svg" width={width} height={height}>
      {relationships.map((r) => {
        const ports = autoPorts(r.from, r.to);
        if (!ports) return null;
        const { a, b, selfJoin } = ports;
        const isActive = selected?.type === "rel" && selected.id === r.id;
        const isHover = hovered === r.id;
        const touchesSelTable = selected?.type === "table" && (r.from.table === selected.id || r.to.table === selected.id);
        const emphasize = isActive || isHover || touchesSelTable;
        const dimmed = selected && !isActive && !touchesSelTable && !isHover;
        const fkColor = r.onDelete ? FK_COLOR_MAP[r.onDelete] : null;
        const conceptual = !r?.from?.col && !r?.to?.col;
        const relLabel = conceptualRelationshipLabel(r);
        const strokeCls = `rel-line ${r.dashed ? "" : "strong"} ${emphasize ? "active" : ""} ${r.identifying ? "identifying" : ""} ${dimmed ? "dimmed" : ""}`;
        return (
          <g key={r.id}
             onClick={(e) => { e.stopPropagation(); onSelect({ type: "rel", id: r.id }); }}
             onDoubleClick={(e) => {
               e.stopPropagation();
               onSelect({ type: "rel", id: r.id });
               openRelationshipEditor(openModal, r, tables, modelKind);
             }}
             onMouseEnter={() => setHovered(r.id)}
             onMouseLeave={() => setHovered(null)}
             style={{ cursor: "pointer" }}>
            <path d={path(a, b, selfJoin)} stroke="transparent" strokeWidth="14" fill="none" style={{ pointerEvents: "stroke" }} />
            <path d={path(a, b, selfJoin)} className={strokeCls} strokeDasharray={r.dashed ? "4 3" : undefined} style={{ pointerEvents: "none" }} />
            {drawEnd(a.x, a.y, a.side, r.from, r.id + "-a", emphasize, dimmed)}
            {drawEnd(b.x, b.y, b.side, r.to,   r.id + "-b", emphasize, dimmed)}
            {(emphasize || !selected) && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4}
                    className={`rel-label ${emphasize ? "active" : ""} ${dimmed ? "dimmed" : ""}`}
                    textAnchor="middle">
                {conceptual && relLabel ? (
                  <>
                    <tspan x={(a.x + b.x) / 2} dy="0">{relLabel}</tspan>
                    <tspan x={(a.x + b.x) / 2} dy="12">{NOTATION.cardinalityLabel(r.from.min, r.from.max)} : {NOTATION.cardinalityLabel(r.to.min, r.to.max)}</tspan>
                  </>
                ) : (
                  `${NOTATION.cardinalityLabel(r.from.min, r.from.max)} : ${NOTATION.cardinalityLabel(r.to.min, r.to.max)}`
                )}
              </text>
            )}
            {fkColor && emphasize && (
              <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="3.5" fill={fkColor} stroke="var(--bg-canvas)" strokeWidth="1.5" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function SubjectAreas({ areas }) {
  return (
    <>
      {areas.map((a) => (
        <div key={a.id} className={`subject-area cat-${a.cat}`} style={{ left: a.x, top: a.y, width: a.w, height: a.h }}>
          <span className={`subject-area-label cat-${a.cat}`}>{a.label}{typeof a.count === "number" ? ` · ${a.count}` : ""}</span>
        </div>
      ))}
    </>
  );
}

function LegendEnd({ min, max }) {
  return (
    <svg width="44" height="18" viewBox="0 0 44 18">
      <line x1="0" y1="9" x2="44" y2="9" stroke="var(--text-tertiary)" strokeWidth="1.2" />
      {drawEnd(44, 9, "right", { min, max }, "lg", true)}
    </svg>
  );
}

function Legend({ open, onToggle }) {
  const I = Icon;
  if (!open) {
    return (
      <button className="legend-toggle" onClick={onToggle}>
        <I.Info /><span>Legend</span>
      </button>
    );
  }
  return (
    <div className="legend">
      <div className="legend-head">
        <span>Notation guide</span>
        <button className="icon-btn" onClick={onToggle}><I.X /></button>
      </div>
      <div className="legend-section">
        <div className="legend-section-title">Cardinality</div>
        {[
          { l: "Exactly one", sub: "1",    svg: <LegendEnd min="1" max="1" /> },
          { l: "Zero or one", sub: "0..1", svg: <LegendEnd min="0" max="1" /> },
          { l: "One or many", sub: "1..N", svg: <LegendEnd min="1" max="N" /> },
          { l: "Zero or many", sub: "0..N", svg: <LegendEnd min="0" max="N" /> },
        ].map((r) => (
          <div key={r.l} className="legend-row">
            <div className="legend-gly">{r.svg}</div>
            <span className="legend-l">{r.l}</span>
            <span className="legend-sub">{r.sub}</span>
          </div>
        ))}
      </div>
      <div className="legend-section">
        <div className="legend-section-title">Relationship kind</div>
        {[
          { I: I.OneToOne,  l: "One-to-one",      sub: "1 : 1" },
          { I: I.OneToMany, l: "One-to-many",     sub: "1 : N" },
          { I: I.ManyToOne, l: "Many-to-one",     sub: "N : 1" },
          { I: I.ManyToMany,l: "Many-to-many",    sub: "N : M" },
          { I: I.SelfRef,   l: "Self-referential",sub: "same table" },
          { I: I.Identifying,l: "Identifying",    sub: "FK in PK" },
          { I: I.NonIdent,   l: "Non-identifying",sub: "FK regular" },
        ].map((r) => (
          <div key={r.l} className="legend-row">
            <div className="legend-gly"><r.I /></div>
            <span className="legend-l">{r.l}</span>
            <span className="legend-sub">{r.sub}</span>
          </div>
        ))}
      </div>
      <div className="legend-section">
        <div className="legend-section-title">Constraints</div>
        {[
          { I: I.Key,      l: "Primary key", k: "PK", col: "var(--pk)" },
          { I: I.Link,     l: "Foreign key", k: "FK", col: "var(--fk)" },
          { I: I.Unique,   l: "Unique",      k: "UQ" },
          { I: I.Check2,   l: "Check",       k: "CK" },
          { I: I.Default,  l: "Default",     k: "DF" },
          { I: I.NotNull,  l: "Not null",    k: "NN" },
          { I: I.Generated,l: "Generated",   k: "GN" },
          { I: I.Hash,     l: "Index",       k: "IX", col: "var(--idx)" },
          { I: I.Partition,l: "Partitioned", k: "PA" },
        ].map((r) => (
          <div key={r.l} className="legend-row">
            <div className="legend-gly" style={r.col ? { color: r.col } : {}}><r.I /></div>
            <span className="legend-l">{r.l}</span>
            <span className="legend-sub">{r.k}</span>
          </div>
        ))}
      </div>
      <div className="legend-section">
        <div className="legend-section-title">FK actions</div>
        {[
          { I: I.Cascade,  l: "CASCADE",     sub: "Delete dependents", c: "#ef4444" },
          { I: I.Restrict, l: "RESTRICT",    sub: "Block delete",      c: "#f59e0b" },
          { I: I.SetNull,  l: "SET NULL",    sub: "Null the FK",       c: "#64748b" },
          { I: I.Default,  l: "SET DEFAULT", sub: "Revert to default", c: "#8b5cf6" },
          { I: I.NoAction, l: "NO ACTION",   sub: "Deferred error",    c: "#6b7385" },
        ].map((r) => (
          <div key={r.l} className="legend-row">
            <div className="legend-gly" style={{ color: r.c }}><r.I /></div>
            <span className="legend-l">{r.l}</span>
            <span className="legend-sub">{r.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Canvas({ tables, setTables, relationships, areas, selected, onSelect, onMoveEnd, onConnect, onDropYamlSource, onDeleteEntity, onDeleteRelationship, onAutoLayout, onFit, onExport, title, engine, modelKind = "physical", legendOpen, setLegendOpen }) {
  // Git-diff overlay (v0.4.2). Subscribe to the entity→status map so each
  // TableCard can render an ADD/MOD/DEL decoration. Pulled here at the
  // Canvas level (not individual TableCards) so every card reads the same
  // snapshot per render pass, avoiding N subscriptions for large diagrams.
  const diffEntities = useUiStore((s) => s.diffState?.entities) || {};
  const setBottomPanelTab = useUiStore((s) => s.setBottomPanelTab);
  const setBottomPanelOpen = useUiStore((s) => s.setBottomPanelOpen);
  const setRightPanelOpen = useUiStore((s) => s.setRightPanelOpen);
  const setRightPanelTab = useUiStore((s) => s.setRightPanelTab);
  const openModal = useUiStore((s) => s.openModal);
  const I = Icon;
  const [hovered, setHovered] = React.useState(null);
  const viewportRef = React.useRef(null);
  const stageRef = React.useRef(null);
  const [zoom, setZoom] = React.useState(1);
  const [viewportState, setViewportState] = React.useState({ left: 0, top: 0, width: 1, height: 1 });
  const world = React.useMemo(() => getWorldBounds(tables, modelKind), [tables, modelKind]);
  const conceptualMode = String(modelKind || "").toLowerCase() === "conceptual";
  const renderedAreas = React.useMemo(
    () => conceptualMode
      ? buildConceptualAreas(tables, areas)
      : (areas || []),
    [areas, conceptualMode, tables]
  );
  const scaledWidth = Math.max(world.width * zoom, viewportState.width || 0);
  const scaledHeight = Math.max(world.height * zoom, viewportState.height || 0);

  // Live connect-drag state: set on mousedown over a column key, cleared on
  // mouseup. While active, we draw a temporary rubber-band line from the
  // source column to the cursor. On release we sniff the element under the
  // cursor for a `.tc-key` match and, if found, call `onConnect` with both
  // endpoints. The Shell opens `NewRelationshipDialog` from there.
  const [connectDrag, setConnectDrag] = React.useState(null);

  const onMoveTable = (id, x, y) => {
    setTables((ts) => ts.map((t) => (t.id === id ? { ...t, x: Math.max(0, x), y: Math.max(0, y) } : t)));
  };

  const handleStartConnect = React.useCallback((seed, downEvent) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    // Start coords: the column's key dot, converted to canvas-inner space.
    const keyEl = downEvent.target.closest(".tc-key");
    const keyRect = keyEl?.getBoundingClientRect();
    const startX = keyRect ? (keyRect.left + keyRect.width / 2 - rect.left) / zoom : (downEvent.clientX - rect.left) / zoom;
    const startY = keyRect ? (keyRect.top + keyRect.height / 2 - rect.top) / zoom : (downEvent.clientY - rect.top) / zoom;

    setConnectDrag({
      ...seed,
      startX, startY,
      curX: startX, curY: startY,
    });

    const onMove = (ev) => {
      const r = stage.getBoundingClientRect();
      setConnectDrag((prev) => prev ? { ...prev, curX: (ev.clientX - r.left) / zoom, curY: (ev.clientY - r.top) / zoom } : prev);
    };
    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Pick the element under the cursor. Column key hits create column-level
      // relationships; card hits create entity-level relationships.
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const keyHit = hit?.closest?.(".tc-key");
      const rowHit = keyHit?.closest?.(".tc-row");
      const cardHit = (keyHit?.closest?.(".table-card")) || hit?.closest?.(".table-card");
      const toTableId = cardHit?.id?.replace(/^tc-/, "") || null;
      const toColName = rowHit?.getAttribute("data-col") || "";
      setConnectDrag(null);
      if (
        toTableId &&
        (toTableId !== seed.fromTable || toColName !== (seed.fromColumn || "")) &&
        onConnect
      ) {
        onConnect({
          fromEntity: seed.fromTable,
          fromColumn: seed.fromColumn || "",
          toEntity: toTableId,
          toColumn: toColName,
        });
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [onConnect, zoom]);

  const syncViewport = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setViewportState({
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    });
  }, []);

  React.useEffect(() => {
    syncViewport();
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    viewport.addEventListener("scroll", syncViewport, { passive: true });
    window.addEventListener("resize", syncViewport);
    return () => {
      viewport.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
    };
  }, [syncViewport]);

  const applyZoom = React.useCallback((nextZoom) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    const focusX = viewport.clientWidth / 2;
    const focusY = viewport.clientHeight / 2;
    const worldX = (viewport.scrollLeft + focusX) / zoom;
    const worldY = (viewport.scrollTop + focusY) / zoom;
    setZoom(clamped);
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, worldX * clamped - focusX);
      viewport.scrollTop = Math.max(0, worldY * clamped - focusY);
      syncViewport();
    });
  }, [syncViewport, zoom]);

  // Fit: scroll the .canvas viewport so the bounding box of all tables is in
  // view. The legacy canvas used to only scroll to the top-left; now it
  // computes a real zoom-to-fit and centers the model in the viewport.
  const handleFit = React.useCallback(() => {
    if (onFit) { onFit(); return; }
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!tables.length) return;
    const padding = 48;
    const rawWidth = Math.max(1, world.maxX - world.minX + padding * 2);
    const rawHeight = Math.max(1, world.maxY - world.minY + padding * 2);
    const fitZoom = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        (viewport.clientWidth - padding * 2) / rawWidth,
        (viewport.clientHeight - padding * 2) / rawHeight,
      ),
    );
    setZoom(fitZoom);
    window.requestAnimationFrame(() => {
      const left = Math.max(0, (world.minX - padding) * fitZoom - Math.max(0, viewport.clientWidth - rawWidth * fitZoom) / 2);
      const top = Math.max(0, (world.minY - padding) * fitZoom - Math.max(0, viewport.clientHeight - rawHeight * fitZoom) / 2);
      viewport.scrollTo({ left, top, behavior: "smooth" });
      syncViewport();
    });
  }, [onFit, syncViewport, tables.length, world]);

  const handleAutoLayoutClick = React.useCallback(async () => {
    if (!onAutoLayout) return;
    await onAutoLayout();
    window.requestAnimationFrame(() => handleFit());
  }, [handleFit, onAutoLayout]);

  const selectedTable = React.useMemo(
    () => (selected?.type === "table" ? tables.find((table) => table.id === selected.id) || null : null),
    [selected, tables]
  );

  const openStudio = React.useCallback(() => {
    setBottomPanelOpen(true);
    setBottomPanelTab("modeler");
  }, [setBottomPanelOpen, setBottomPanelTab]);

  const openNewConceptDialog = React.useCallback((point = {}) => {
    openModal("newConcept", {
      x: Number.isFinite(Number(point.x)) ? Number(point.x) : undefined,
      y: Number.isFinite(Number(point.y)) ? Number(point.y) : undefined,
    });
  }, [openModal]);

  const openConceptDetails = React.useCallback(() => {
    setRightPanelOpen(true);
    setRightPanelTab("DETAILS");
  }, [setRightPanelOpen, setRightPanelTab]);

  const openRelationshipDialog = React.useCallback(() => {
    const orderedTables = Array.isArray(tables) ? tables : [];
    const first = selectedTable || orderedTables[0] || null;
    const second = orderedTables.find((table) => table.id !== first?.id) || orderedTables[1] || null;
    const normalizedKind = String(modelKind || "physical").toLowerCase();
    const defaultColumn = (table) => {
      const cols = Array.isArray(table?.columns) ? table.columns : [];
      return (
        cols.find((col) => col?.pk)?.name ||
        cols.find((col) => String(col?.name || "").toLowerCase() === "id")?.name ||
        cols[0]?.name ||
        ""
      );
    };
    openModal("newRelationship", {
      modelKind: normalizedKind,
      conceptualLevel: normalizedKind === "conceptual",
      tables: orderedTables.map((table) => ({
        id: table.name || table.id,
        name: table.name || table.id,
        columns: normalizedKind === "conceptual" ? [] : (table.columns || []),
      })),
      fromEntity: first?.name || first?.id || "",
      toEntity: second?.name || second?.id || "",
      fromColumn: normalizedKind === "physical" ? defaultColumn(first) : "",
      toColumn: normalizedKind === "physical" ? defaultColumn(second) : "",
    });
  }, [modelKind, openModal, selectedTable, tables]);

  // Keyboard Delete / Backspace → delete the currently selected entity or
  // relationship. Ignored while the user is typing in an input/textarea or a
  // contentEditable region so column-name edits in the inspector don't nuke
  // the whole table.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tgt = e.target;
      const tag = (tgt?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (tgt?.isContentEditable) return;
      if (!selected) return;
      if (selected.type === "table" && onDeleteEntity) {
        e.preventDefault();
        onDeleteEntity(selected.id);
      } else if (selected.type === "rel" && onDeleteRelationship) {
        e.preventDefault();
        onDeleteRelationship(selected.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, onDeleteEntity, onDeleteRelationship]);

  return (
    <div className="canvas-wrap">
      <div className="canvas-grid" />
      <div className="canvas-chrome">
        <div className="canvas-title">
          <h1>{title}</h1>
          <p>
            <span className="engine">{engine}</span>
            <span className="dot" />
            <span>{modelKind}</span>
            <span className="dot" />
            <span>{tables.length} objects</span>
            <span className="dot" />
            <span>{relationships.length} relationships</span>
          </p>
        </div>
        <div className="canvas-actions" data-tour="workbench-studio">
          {conceptualMode && (
            <>
              <button data-tour="add-entities" className="canvas-btn" onClick={() => openNewConceptDialog()} title="Create a business concept box in this diagram">
                <I.Plus />Add Concept
              </button>
              <button
                data-tour="add-relationship"
                className="canvas-btn"
                onClick={openRelationshipDialog}
                title="Create a business relationship between concept boxes"
                disabled={tables.length < 2}
              >
                <I.Relation />Add Relationship
              </button>
              <button
                className="canvas-btn"
                onClick={openConceptDetails}
                title="Open the Details panel for business metadata"
                disabled={!selectedTable}
              >
                <I.Edit />Edit Details
              </button>
            </>
          )}
          {!conceptualMode && String(modelKind || "").toLowerCase() === "logical" && (
            <>
              <button data-tour="add-entities" className="canvas-btn" onClick={openStudio} title="Add logical entities, attributes, keys, and generated dbt output">
                <I.Plus />Add Entity
              </button>
              <button
                data-tour="add-relationship"
                className="canvas-btn"
                onClick={openRelationshipDialog}
                title="Create a logical relationship with roles, cardinality, and optionality"
                disabled={tables.length < 2}
              >
                <I.Relation />Add Relationship
              </button>
            </>
          )}
          {!conceptualMode && String(modelKind || "").toLowerCase() === "physical" && (
            <>
              <button data-tour="add-entities" className="canvas-btn" onClick={openStudio} title="Open physical dbt YAML, SQL preview, and constraint workflow">
                <I.Plus />Physical Studio
              </button>
              <button
                data-tour="add-relationship"
                className="canvas-btn"
                onClick={openRelationshipDialog}
                title="Create a physical dbt/database relationship"
                disabled={tables.length < 2}
              >
                <I.Relation />Add Relationship
              </button>
            </>
          )}
          <button className="canvas-btn" onClick={() => handleFit()} title="Fit all entities into view"><I.Fit />Fit</button>
          <button className="canvas-btn" onClick={() => handleAutoLayoutClick()} title="Auto-layout (ELK)"><I.Grid />Auto-layout</button>
          {onExport && <button className="canvas-btn" onClick={() => onExport()} title="Export DDL / SQL"><I.Download />Export</button>}
        </div>
      </div>

      <div className="canvas" ref={viewportRef}>
        <div
          className="canvas-inner"
          style={{ width: scaledWidth, height: scaledHeight }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onSelect(null);
          }}
          onDoubleClick={(e) => {
            if (conceptualMode && e.target === e.currentTarget) {
              const rect = stageRef.current?.getBoundingClientRect();
              openNewConceptDialog({
                x: rect ? Math.max(0, (e.clientX - rect.left) / zoom) : undefined,
                y: rect ? Math.max(0, (e.clientY - rect.top) / zoom) : undefined,
              });
            }
          }}
        >
          <div
            className="canvas-stage"
            ref={stageRef}
            style={{ width: world.width, height: world.height, transform: `scale(${zoom})`, transformOrigin: "top left" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) onSelect(null);
            }}
            onDoubleClick={(e) => {
              if (conceptualMode && e.target === e.currentTarget) {
                const rect = stageRef.current?.getBoundingClientRect();
                openNewConceptDialog({
                  x: rect ? Math.max(0, (e.clientX - rect.left) / zoom) : undefined,
                  y: rect ? Math.max(0, (e.clientY - rect.top) / zoom) : undefined,
                });
              }
            }}
            onDragOver={onDropYamlSource ? (e) => {
              // Accept the drag only if it advertises a YAML source payload —
              // plain file-path drags (folder moves) fall through.
              if (Array.from(e.dataTransfer.types || []).includes("application/x-datalex-yaml-source")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            } : undefined}
            onDrop={onDropYamlSource ? (e) => {
              const raw = e.dataTransfer.getData("application/x-datalex-yaml-source");
              if (!raw) return;
              e.preventDefault();
              let payload;
              try { payload = JSON.parse(raw); } catch (_err) { return; }
              if (!payload || !payload.path) return;
              const stage = stageRef.current;
              const rect = stage?.getBoundingClientRect();
              const x = rect ? Math.max(0, (e.clientX - rect.left) / zoom) : 60;
              const y = rect ? Math.max(0, (e.clientY - rect.top) / zoom) : 60;
              onDropYamlSource({ path: payload.path, x, y });
            } : undefined}
          >
            {conceptualMode && tables.length === 0 && (
              <div
                style={{
                  position: "absolute",
                  left: 48,
                  top: 72,
                  zIndex: 1,
                  width: 360,
                  padding: 18,
                  borderRadius: 14,
                  border: "1px solid var(--border-strong)",
                  background: "color-mix(in srgb, var(--bg-2) 92%, transparent)",
                  boxShadow: "var(--shadow-pop)",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
                  Conceptual Flow
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                  Start by adding your first concept box
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                  Conceptual mode is for business concepts and business relationships. Add the box first, then connect concepts with relationship arrows, then edit business meaning in Details.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="canvas-btn" onClick={() => openNewConceptDialog({ x: 120, y: 120 })}>
                    <I.Plus />Add Concept
                  </button>
                  <button className="canvas-btn" onClick={openConceptDetails} disabled={!selectedTable}>
                    <I.Edit />Edit Details
                  </button>
                </div>
              </div>
            )}
            <SubjectAreas areas={renderedAreas} />
            <Relationships tables={tables} relationships={relationships}
                           selected={selected} onSelect={onSelect}
                           hovered={hovered} setHovered={setHovered}
                           width={world.width} height={world.height}
                           zoom={zoom} stageRef={stageRef}
                           modelKind={modelKind} />
            {tables.map((t) => (
              <NodeErrorBoundary
                key={t.id}
                label={t?.name || t?.id || "entity"}
                style={{ position: "absolute", left: t?.x ?? 40, top: t?.y ?? 40 }}
              >
                <TableCard table={t}
                           selected={selected?.type === "table" && selected.id === t.id}
                           onSelect={onSelect}
                           onMove={onMoveTable}
                           onMoveEnd={onMoveEnd}
                           onStartConnect={handleStartConnect}
                           diffStatus={diffEntities[t.name] || diffEntities[t.id] || null}
                           zoom={zoom}
                           modelKind={modelKind} />
              </NodeErrorBoundary>
            ))}
            {connectDrag && (
              <svg
                className="rel-svg"
                width={world.width}
                height={world.height}
                style={{ pointerEvents: "none", position: "absolute", inset: 0 }}
                aria-hidden="true"
              >
                <line
                  x1={connectDrag.startX}
                  y1={connectDrag.startY}
                  x2={connectDrag.curX}
                  y2={connectDrag.curY}
                  stroke="var(--accent)"
                  strokeWidth="1.6"
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                />
                <circle cx={connectDrag.curX} cy={connectDrag.curY} r="3.5"
                        fill="var(--accent)" stroke="var(--bg-canvas)" strokeWidth="1.5" />
              </svg>
            )}
          </div>
        </div>
      </div>

      <Legend open={legendOpen} onToggle={() => setLegendOpen((v) => !v)} />

      <div className="minimap">
        <div className="minimap-title">Overview</div>
        <div className="minimap-canvas">
          {tables.map((t) => (
            <div key={t.id} className="mm-table"
                 style={{
                   left: `${(t.x / Math.max(1, world.width)) * 100}%`,
                   top: `${(t.y / Math.max(1, world.height)) * 100}%`,
                   width: `${(estimateTableBounds(t).width / Math.max(1, world.width)) * 100}%`,
                   height: `${(estimateTableBounds(t).height / Math.max(1, world.height)) * 100}%`,
                   background: `var(--cat-${t.cat})`,
                   opacity: 0.6,
                 }} />
          ))}
          <div
            className="mm-viewport"
            style={{
              left: `${(viewportState.left / Math.max(1, world.width * zoom)) * 100}%`,
              top: `${(viewportState.top / Math.max(1, world.height * zoom)) * 100}%`,
              width: `${(viewportState.width / Math.max(1, world.width * zoom)) * 100}%`,
              height: `${(viewportState.height / Math.max(1, world.height * zoom)) * 100}%`,
            }}
          />
        </div>
      </div>

      <div className="zoom-bar">
        <button className="zoom-btn" title="Zoom out" onClick={() => applyZoom(zoom - 0.1)}><I.Minus /></button>
        <div className="zoom-level">{Math.round(zoom * 100)}%</div>
        <button className="zoom-btn" title="Zoom in" onClick={() => applyZoom(zoom + 0.1)}><I.Plus /></button>
        <button className="zoom-btn" title="Fit" onClick={() => handleFit()}><I.Fit /></button>
      </div>
    </div>
  );
}
