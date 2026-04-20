/* Right inspector panel — supports table OR relationship selection. Ported from DataLex design prototype. */
import React from "react";
import Icon from "./icons";
import { NOTATION } from "./notation";

function renderSQL(t) {
  const kw = (s) => `<span class="sql-kw">${s}</span>`;
  const ty = (s) => `<span class="sql-type">${s}</span>`;
  const co = (s) => `<span class="sql-comment">${s}</span>`;
  let out = "";
  out += co(`-- ${t.subject} / ${t.name}\n`);
  out += `${kw("CREATE TABLE")} ${t.schema}.${t.name} (\n`;
  t.columns.forEach((c, i) => {
    const parts = [`  ${c.name}`, ty(c.type)];
    if (c.pk) parts.push(kw("PRIMARY KEY"));
    if (c.nn && !c.pk) parts.push(kw("NOT NULL"));
    if (c.unique && !c.pk) parts.push(kw("UNIQUE"));
    out += parts.join(" ") + (i < t.columns.length - 1 ? "," : "") + "\n";
  });
  out += ");\n";
  t.columns.filter((c) => c.fk).forEach((c) => {
    out += `${kw("ALTER TABLE")} ${t.schema}.${t.name}\n  ${kw("ADD FOREIGN KEY")} (${c.name}) ${kw("REFERENCES")} ${c.fk.split(".")[0]}(${c.fk.split(".")[1]});\n`;
  });
  return out;
}

function RelInspector({ rel }) {
  const I = Icon;
  const N = NOTATION;
  const kind = N.kind(rel.from, rel.to);
  const KindIcon = { "1:1": I.OneToOne, "1:N": I.OneToMany, "N:1": I.ManyToOne, "N:M": I.ManyToMany }[kind] || I.OneToMany;
  const actions = N.onDeleteActions;

  return (
    <div className="right">
      <div className="insp-header">
        <div className="insp-eyebrow">
          <span className="pill" style={{ background: "var(--accent-dim)", color: "var(--accent)" }}>Relationship</span>
          {rel.identifying && <span className="pill" style={{ background: "rgba(245,181,68,0.14)", color: "var(--pk)" }}>Identifying</span>}
          {rel.dashed && <span className="pill" style={{ background: "rgba(107,115,133,0.18)", color: "var(--text-secondary)" }}>Optional</span>}
        </div>
        <div className="insp-title">
          <h2 style={{ fontSize: 14 }}>{rel.name}</h2>
          <button className="copy-btn" style={{ marginLeft: "auto" }}><I.Edit /></button>
          <button className="copy-btn"><I.Trash /></button>
        </div>
        <div style={{ marginTop: 8 }}>
          <span className="rel-insp-kind"><KindIcon /> {kind}</span>
        </div>
      </div>

      <div className="insp-body">
        <div className="insp-section">
          <div className="insp-section-title"><span>Endpoints</span></div>
          <div className="rel-route">
            <div className="rel-route-col">
              <span className="rel-route-table">{rel.from.table}</span>
              <span className="rel-route-field">{rel.from.col}</span>
              <span className="rel-route-card">{N.cardinalityLabel(rel.from.min, rel.from.max)}</span>
            </div>
            <I.Arrow className="rel-route-arrow" />
            <div className="rel-route-col">
              <span className="rel-route-table">{rel.to.table}</span>
              <span className="rel-route-field">{rel.to.col}</span>
              <span className="rel-route-card">{N.cardinalityLabel(rel.to.min, rel.to.max)}</span>
            </div>
          </div>
        </div>

        <div className="insp-section">
          <div className="insp-section-title"><span>ON DELETE</span></div>
          <div className="action-picker">
            {actions.map((a) => (
              <div key={a.k} className={`action ${rel.onDelete === a.k ? "on" : ""}`} title={a.desc}>
                <span className="dot" style={{ background: a.color }} />{a.k}
              </div>
            ))}
          </div>
        </div>

        <div className="insp-section">
          <div className="insp-section-title"><span>ON UPDATE</span></div>
          <div className="action-picker">
            {actions.map((a) => (
              <div key={a.k} className={`action ${rel.onUpdate === a.k ? "on" : ""}`} title={a.desc}>
                <span className="dot" style={{ background: a.color }} />{a.k}
              </div>
            ))}
          </div>
        </div>

        <div className="insp-section">
          <div className="insp-section-title"><span>Options</span></div>
          <div className="field-flags">
            {[
              { k: "id",    l: "IDENTIFYING", on: !!rel.identifying },
              { k: "df",    l: "DEFERRABLE",  on: false },
              { k: "idx",   l: "FK INDEX",    on: true },
              { k: "match", l: "MATCH FULL",  on: false },
            ].map((f) => (
              <div key={f.k} className={`flag ${f.on ? "on" : ""}`}>
                <div className="check">{f.on && <I.Check />}</div>
                <span>{f.l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RightPanel({ table, rel, tables, selectedCol, setSelectedCol }) {
  const I = Icon;
  const [tab, setTab] = React.useState("COLUMNS");

  if (rel) return <RelInspector rel={rel} tables={tables} />;

  if (!table) {
    return (
      <div className="right">
        <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 12 }}>
          <div style={{ marginBottom: 12, opacity: 0.3 }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="8" y="10" width="32" height="28" rx="3" />
              <path d="M8 18h32 M8 26h32 M18 10v28 M28 10v28" />
            </svg>
          </div>
          Select a table or relationship
        </div>
      </div>
    );
  }

  const col = table.columns.find((c) => c.name === selectedCol) || table.columns[0];

  return (
    <div className="right">
      <div className="insp-header">
        <div className="insp-eyebrow">
          <span className="pill" style={{
            background: `var(--cat-${table.cat}-soft)`,
            color: `var(--cat-${table.cat})`,
          }}>{table.subject}</span>
          <span>Table</span>
        </div>
        <div className="insp-title">
          <h2>{table.name}</h2>
          <button className="copy-btn" title="Copy name"><I.Copy /></button>
          <button className="copy-btn" title="Edit" style={{ marginLeft: "auto" }}><I.Edit /></button>
          <button className="copy-btn" title="Delete"><I.Trash /></button>
        </div>
        <div className="insp-sub">
          {table.schema}.{table.name} · {table.columns.length} columns{table.rowCount ? ` · ${table.rowCount}${typeof table.rowCount === "number" ? " rows" : ""}` : ""}
        </div>
      </div>

      <div className="insp-tabs">
        {["COLUMNS", "RELATIONS", "INDEXES", "SQL"].map((t) => (
          <button key={t} className={`insp-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t[0] + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="insp-body">
        {tab === "COLUMNS" && (
          <>
            <div className="insp-section">
              <div className="insp-section-title"><span>Selected column</span></div>
              <div className="field"><div className="field-row">
                <span className="field-label">Name</span>
                <input className="field-input" defaultValue={col?.name} />
              </div></div>
              <div className="field"><div className="field-row">
                <span className="field-label">Type</span>
                <select className="field-select" defaultValue={col?.type}>
                  <option>{col?.type}</option>
                  <option>integer</option><option>varchar(255)</option><option>text</option>
                  <option>timestamptz</option><option>jsonb</option>
                </select>
              </div></div>
              <div className="field"><div className="field-row">
                <span className="field-label">Default</span>
                <input className="field-input" placeholder="NULL" defaultValue={col?.default || ""} />
              </div></div>
              <div className="field"><div className="field-row">
                <span className="field-label">Comment</span>
                <input className="field-input" placeholder="—" />
              </div></div>
              <div className="field"><div className="field-row">
                <span className="field-label">Flags</span>
                <div className="field-flags">
                  {[
                    { k: "pk",  l: "PK",       on: !!col?.pk },
                    { k: "nn",  l: "NOT NULL", on: !!col?.nn },
                    { k: "uq",  l: "UNIQUE",   on: !!col?.unique },
                    { k: "fk",  l: "FK",       on: !!col?.fk },
                    { k: "idx", l: "INDEX",    on: false },
                  ].map((f) => (
                    <div key={f.k} className={`flag ${f.on ? "on" : ""}`}>
                      <div className="check">{f.on && <I.Check />}</div>
                      <span>{f.l}</span>
                    </div>
                  ))}
                </div>
              </div></div>
            </div>

            <div className="insp-section">
              <div className="insp-section-title">
                <span>All columns</span>
                <span className="count">{table.columns.length}</span>
              </div>
              <div className="col-list">
                {table.columns.map((c) => (
                  <div key={c.name}
                       className={`col-item ${c.name === col?.name ? "active" : ""}`}
                       onClick={() => setSelectedCol(c.name)}>
                    <div className={`col-item-key ${c.pk ? "pk" : ""} ${c.fk ? "fk" : ""}`}>
                      {c.pk ? <I.Key /> : c.fk ? <I.Link /> : (
                        <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--text-muted)" }} />
                      )}
                    </div>
                    <div className="col-item-name">{c.name}</div>
                    <div className="col-item-type">{c.type}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === "RELATIONS" && (
          <div className="insp-section">
            <div className="insp-section-title">
              <span>Incoming & outgoing</span>
              <button className="icon-btn"><I.Plus /></button>
            </div>
            {table.columns.filter((c) => c.fk).map((c) => (
              <div key={c.name} className="rel-card">
                <div className="rel-title">
                  <I.Link style={{ width: 12, height: 12, color: "var(--fk)" }} />
                  {table.name}.{c.name}
                  <span className="rel-cardinality">N : 1</span>
                </div>
                <div className="rel-sub">→ {c.fk}</div>
              </div>
            ))}
            {table.columns.filter((c) => c.fk).length === 0 && (
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "20px 0", textAlign: "center" }}>
                No relationships
              </div>
            )}
          </div>
        )}

        {tab === "INDEXES" && (
          <div className="insp-section">
            <div className="insp-section-title"><span>Indexes</span><button className="icon-btn"><I.Plus /></button></div>
            {[
              { name: `${table.name}_pkey`, cols: table.columns.filter((c) => c.pk).map((c) => c.name), unique: true, kind: "btree" },
              ...(table.columns.some((c) => c.unique)
                ? [{ name: `${table.name}_unique_idx`, cols: table.columns.filter((c) => c.unique).map((c) => c.name), unique: true, kind: "btree" }]
                : []),
            ].filter((ix) => ix.cols.length).map((ix) => (
              <div key={ix.name} className="rel-card">
                <div className="rel-title">
                  <I.Hash style={{ width: 12, height: 12, color: "var(--idx)" }} />
                  {ix.name}
                  {ix.unique && <span className="rel-cardinality">UNIQUE</span>}
                </div>
                <div className="rel-sub">{ix.kind}({ix.cols.join(", ")})</div>
              </div>
            ))}
          </div>
        )}

        {tab === "SQL" && (
          <div className="insp-section">
            <div className="insp-section-title">
              <span>CREATE statement</span>
              <button className="icon-btn"><I.Copy /></button>
            </div>
            <pre className="sql-preview"><code dangerouslySetInnerHTML={{ __html: renderSQL(table) }} /></pre>
          </div>
        )}
      </div>
    </div>
  );
}
