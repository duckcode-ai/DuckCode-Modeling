/* Canvas — table cards + crow's foot relationships. Ported from DataLex design prototype. */
import React from "react";
import Icon from "./icons";
import { NOTATION, FK_COLOR_MAP } from "./notation";

function TableCard({ table, selected, onSelect, onMove }) {
  const I = Icon;
  const cardRef = React.useRef(null);
  const drag = React.useRef(null);

  const onMouseDown = (e) => {
    if (e.target.closest(".tc-badges, button, .tc-colflags")) return;
    const rect = cardRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    onSelect({ type: "table", id: table.id });
    const onMove2 = (ev) => {
      const parent = cardRef.current.parentElement.getBoundingClientRect();
      onMove(table.id, ev.clientX - parent.left - drag.current.dx, ev.clientY - parent.top - drag.current.dy);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove2);
      window.removeEventListener("mouseup", onUp);
      drag.current = null;
    };
    window.addEventListener("mousemove", onMove2);
    window.addEventListener("mouseup", onUp);
  };

  const colFlags = (c) => {
    const flags = [];
    if (c.unique && !c.pk) flags.push({ k: "UQ", I: I.Unique, title: "UNIQUE" });
    if (c.check) flags.push({ k: "CK", I: I.Check2, title: "CHECK: " + c.check });
    if (c.default) flags.push({ k: "DF", I: I.Default, title: "DEFAULT " + c.default });
    if (c.generated) flags.push({ k: "GN", I: I.Generated, title: "GENERATED" });
    return flags;
  };

  return (
    <div
      ref={cardRef}
      className={`table-card cat-${table.cat} ${selected ? "selected" : ""} ${table.junction ? "junction" : ""}`}
      id={`tc-${table.id}`}
      style={{ left: table.x, top: table.y }}
      onMouseDown={onMouseDown}
    >
      <div className="tc-header">
        {table.kind === "ENUM" ? <I.Enum /> : table.junction ? <I.Junction /> : <I.Table />}
        <span className="tc-name">{table.name}</span>
        <span className="tc-schema">{table.schema}</span>
        <div className="tc-badges">
          {(table.badges || []).map((b) => (
            <span key={b} className={`tc-badge ${b.toLowerCase()}`}>{b}</span>
          ))}
        </div>
      </div>
      <div className="tc-rows">
        {table.columns.map((c) => {
          const isPk = c.pk;
          const isFk = !!c.fk;
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
                <span className={`tc-nn ${c.nn ? "required" : ""}`} title={c.nn ? "NOT NULL" : "nullable"}>
                  {c.nn ? "NN" : "·"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {table.kind !== "ENUM" && (
        <div className="tc-footer">
          <span>{table.columns.length} cols</span>
          <span>{table.rowCount}{typeof table.rowCount === "number" ? " rows" : ""}</span>
        </div>
      )}
    </div>
  );
}

/* Crow's-foot glyph drawer (IE notation) */
function drawEnd(x, y, side, spec, idPrefix, active, dimmed) {
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

function Relationships({ tables, relationships, selected, onSelect, hovered, setHovered }) {
  const [anchors, setAnchors] = React.useState({});

  const recalc = React.useCallback(() => {
    const next = {};
    const inner = document.querySelector(".canvas-inner");
    if (!inner) return;
    const innerRect = inner.getBoundingClientRect();
    tables.forEach((t) => {
      const el = document.getElementById(`tc-${t.id}`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      next[t.id] = { x: r.left - innerRect.left, y: r.top - innerRect.top, w: r.width, h: r.height };
      t.columns.forEach((c) => {
        const row = el.querySelector(`.tc-row[data-col="${c.name}"]`);
        if (!row) return;
        const rr = row.getBoundingClientRect();
        next[`${t.id}.${c.name}`] = { cy: rr.top + rr.height / 2 - innerRect.top };
      });
    });
    setAnchors(next);
  }, [tables]);

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
    <svg className="rel-svg" width="2400" height="1600">
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
        const strokeCls = `rel-line ${r.dashed ? "" : "strong"} ${emphasize ? "active" : ""} ${r.identifying ? "identifying" : ""} ${dimmed ? "dimmed" : ""}`;
        return (
          <g key={r.id}
             onClick={(e) => { e.stopPropagation(); onSelect({ type: "rel", id: r.id }); }}
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
                {NOTATION.cardinalityLabel(r.from.min, r.from.max)} : {NOTATION.cardinalityLabel(r.to.min, r.to.max)}
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
          <span className={`subject-area-label cat-${a.cat}`}>{a.label}</span>
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

export default function Canvas({ tables, setTables, relationships, areas, selected, onSelect, title, engine, legendOpen, setLegendOpen }) {
  const I = Icon;
  const [hovered, setHovered] = React.useState(null);
  const onMoveTable = (id, x, y) => {
    setTables((ts) => ts.map((t) => (t.id === id ? { ...t, x: Math.max(0, x), y: Math.max(0, y) } : t)));
  };
  return (
    <div className="canvas-wrap">
      <div className="canvas-grid" />
      <div className="canvas-chrome">
        <div className="canvas-title">
          <h1>{title}</h1>
          <p>
            <span className="engine">{engine}</span>
            <span className="dot" />
            <span>{tables.length} objects</span>
            <span className="dot" />
            <span>{relationships.length} relationships</span>
          </p>
        </div>
        <div className="canvas-actions">
          <button className="canvas-btn"><I.Fit />Fit</button>
          <button className="canvas-btn"><I.Grid />Auto-layout</button>
          <button className="canvas-btn"><I.Download />Export</button>
          <button className="canvas-btn primary"><I.Sparkle />Generate SQL</button>
        </div>
      </div>

      <div className="canvas">
        <div className="canvas-inner" onClick={(e) => {
          if (e.target.classList.contains("canvas-inner")) onSelect(null);
        }}>
          <SubjectAreas areas={areas} />
          <Relationships tables={tables} relationships={relationships}
                         selected={selected} onSelect={onSelect}
                         hovered={hovered} setHovered={setHovered} />
          {tables.map((t) => (
            <TableCard key={t.id} table={t}
                       selected={selected?.type === "table" && selected.id === t.id}
                       onSelect={onSelect}
                       onMove={onMoveTable} />
          ))}
        </div>
      </div>

      <Legend open={legendOpen} onToggle={() => setLegendOpen((v) => !v)} />

      <div className="minimap">
        <div className="minimap-title">Overview</div>
        <div className="minimap-canvas">
          {tables.map((t) => (
            <div key={t.id} className="mm-table"
                 style={{
                   left: `${(t.x / 2400) * 100}%`,
                   top: `${(t.y / 1600) * 100}%`,
                   width: `${(240 / 2400) * 100}%`,
                   height: `${((t.columns.length * 20 + 30) / 1600) * 100}%`,
                   background: `var(--cat-${t.cat})`,
                   opacity: 0.6,
                 }} />
          ))}
          <div className="mm-viewport" style={{ left: "4%", top: "2%", width: "58%", height: "48%" }} />
        </div>
      </div>

      <div className="zoom-bar">
        <button className="zoom-btn"><I.Minus /></button>
        <div className="zoom-level">100%</div>
        <button className="zoom-btn"><I.Plus /></button>
        <button className="zoom-btn" title="Fit"><I.Fit /></button>
      </div>
    </div>
  );
}
