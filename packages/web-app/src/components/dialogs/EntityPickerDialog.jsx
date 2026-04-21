/* Entity picker — multi-select dialog for "add entities to this diagram".
 *
 * Scans every non-diagram YAML in the active project, pulls out entity
 * definitions, filters by search + domain, and on submit appends the
 * selection to the active `.diagram.yaml` via `addDiagramReferences`.
 *
 * Entities that are *already* on the diagram are shown but disabled so
 * the user gets immediate feedback instead of silently no-oping through
 * `addDiagramEntries`'s `(file, entity)` dedupe.
 */
import React, { useMemo, useState } from "react";
import yaml from "js-yaml";
import { LayoutDashboard, AlertCircle, Search } from "lucide-react";
import Modal from "./Modal";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";

const DIAGRAM_RE = /\.diagram\.ya?ml$/i;
const YAML_RE = /\.ya?ml$/i;

/* Parse one file's YAML body and surface every entity declaration in a
   shape the dialog can display + submit. Supports the canonical DataLex
   top-level `entities:` list and the dbt-importer single-doc
   `{kind: model|source, name: …}` shape. */
function extractEntitiesFromYaml(content) {
  if (!content || typeof content !== "string") return [];
  let doc;
  try { doc = yaml.load(content); } catch (_e) { return []; }
  if (!doc || typeof doc !== "object") return [];
  const out = [];
  if (Array.isArray(doc.entities)) {
    doc.entities.forEach((e) => {
      if (!e || typeof e !== "object") return;
      const name = String(e.name || "").trim();
      if (!name) return;
      out.push({
        name,
        subject_area: String(e.subject_area || e.subject || "").trim(),
        description: String(e.description || "").trim(),
        type: String(e.type || "").trim(),
      });
    });
    return out;
  }
  if (typeof doc.kind === "string" && /^(model|source)$/i.test(doc.kind) && typeof doc.name === "string") {
    const name = doc.name.trim();
    if (name) {
      out.push({
        name,
        subject_area: String(doc.subject_area || doc.schema || "").trim(),
        description: String(doc.description || "").trim(),
        type: doc.kind.toLowerCase(),
      });
    }
  }
  return out;
}

function parseDiagramRefs(content) {
  if (!content) return { refs: new Set(), wildcards: new Set() };
  try {
    const doc = yaml.load(content);
    const refs = new Set();
    const wildcards = new Set();
    if (doc && Array.isArray(doc.entities)) {
      doc.entities.forEach((e) => {
        const file = String(e?.file || "").replace(/^[/\\]+/, "");
        const entity = String(e?.entity || "").trim();
        if (!file) return;
        if (!entity || entity === "*") wildcards.add(file);
        else refs.add(`${file}::${entity.toLowerCase()}`);
      });
    }
    return { refs, wildcards };
  } catch (_e) {
    return { refs: new Set(), wildcards: new Set() };
  }
}

export default function EntityPickerDialog() {
  const { closeModal, addToast } = useUiStore();
  const projectFiles = useWorkspaceStore((s) => s.projectFiles);
  const fileContentCache = useWorkspaceStore((s) => s.fileContentCache);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const addDiagramReferences = useWorkspaceStore((s) => s.addDiagramReferences);

  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState(""); // "" = all; "__unassigned__" = no domain
  const [selected, setSelected] = useState(() => new Set()); // keys: `${file}::${entity}`
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isDiagram = !!activeFile && DIAGRAM_RE.test(String(activeFile.name || ""));

  // Build the full candidate list once per content change.
  const { candidates, domains } = useMemo(() => {
    const list = [];
    const domainCounts = new Map();
    (projectFiles || []).forEach((f) => {
      const name = String(f?.name || "");
      const fullPath = String(f?.fullPath || f?.path || "").replace(/^[/\\]+/, "");
      if (!fullPath || !YAML_RE.test(name) || DIAGRAM_RE.test(name)) return;
      const content = (typeof f?.content === "string" ? f.content : null)
        ?? (fileContentCache || {})[fullPath]
        ?? (fileContentCache || {})[f?.fullPath]
        ?? null;
      if (!content) return;
      const ents = extractEntitiesFromYaml(content);
      ents.forEach((e) => {
        list.push({
          file: fullPath,
          name: e.name,
          subject_area: e.subject_area,
          description: e.description,
          type: e.type,
        });
        const dk = e.subject_area || "__unassigned__";
        domainCounts.set(dk, (domainCounts.get(dk) || 0) + 1);
      });
    });
    list.sort((a, b) =>
      (a.subject_area || "").localeCompare(b.subject_area || "") ||
      a.name.localeCompare(b.name)
    );
    const domainEntries = Array.from(domainCounts.entries()).map(([k, v]) => ({ key: k, count: v }));
    domainEntries.sort((a, b) => {
      if (a.key === "__unassigned__") return 1;
      if (b.key === "__unassigned__") return -1;
      return a.key.localeCompare(b.key);
    });
    return { candidates: list, domains: domainEntries };
  }, [projectFiles, fileContentCache]);

  const already = useMemo(() => parseDiagramRefs(activeFileContent), [activeFileContent]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (domain) {
        const d = c.subject_area || "__unassigned__";
        if (d !== domain) return false;
      }
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.subject_area || "").toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q) ||
        c.file.toLowerCase().includes(q)
      );
    });
  }, [candidates, search, domain]);

  const isOnDiagram = (c) =>
    already.refs.has(`${c.file}::${c.name.toLowerCase()}`) || already.wildcards.has(c.file);

  const availableCount = filtered.filter((c) => !isOnDiagram(c)).length;
  const selectableKeys = filtered.filter((c) => !isOnDiagram(c)).map((c) => `${c.file}::${c.name}`);
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));

  const toggle = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev);
        selectableKeys.forEach((k) => next.delete(k));
        return next;
      }
      const next = new Set(prev);
      selectableKeys.forEach((k) => next.add(k));
      return next;
    });
  };

  const submit = async () => {
    if (!isDiagram) {
      setError("Open a .diagram.yaml first.");
      return;
    }
    if (selected.size === 0) return;
    const entries = [];
    selected.forEach((key) => {
      const ix = key.indexOf("::");
      if (ix < 0) return;
      const file = key.slice(0, ix);
      const entity = key.slice(ix + 2);
      entries.push({ file, entity });
    });
    setSubmitting(true);
    try {
      await addDiagramReferences(entries);
      addToast({
        type: "success",
        message: `Added ${entries.length} ${entries.length === 1 ? "entity" : "entities"} to diagram.`,
      });
      // Signal the canvas to re-layout newly added entities (Phase 4.2).
      try {
        window.dispatchEvent(new CustomEvent("dl:diagram:autolayout", {
          detail: { added: entries.map((e) => e.entity) },
        }));
      } catch (_e) { /* non-fatal */ }
      closeModal();
    } catch (err) {
      setError(String(err?.message || err || "Failed to add entities."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isDiagram) {
    return (
      <Modal
        icon={<LayoutDashboard size={14} />}
        title="Add entities"
        size="md"
        onClose={closeModal}
        footer={<button type="button" className="panel-btn" onClick={closeModal}>Close</button>}
      >
        <div className="dlx-modal-alert">
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Open a <code>.diagram.yaml</code> file before picking entities.</span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      icon={<LayoutDashboard size={14} />}
      title="Add entities to diagram"
      subtitle={`Pick one or more entities from the project to drop onto the active diagram.`}
      size="lg"
      onClose={closeModal}
      footerStatus={
        selected.size > 0
          ? `${selected.size} selected`
          : `${availableCount} available, ${candidates.length - availableCount} already on diagram or filtered out`
      }
      footerAlign="between"
      footer={
        <>
          <button type="button" className="panel-btn" onClick={closeModal} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="panel-btn primary"
            onClick={submit}
            disabled={submitting || selected.size === 0}
          >
            {submitting ? "Adding…" : `Add ${selected.size || ""}`.trim()}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Search + domain filter */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 8 }}>
          <div style={{ position: "relative" }}>
            <Search
              size={12}
              style={{ position: "absolute", top: 9, left: 10, color: "var(--text-tertiary)", pointerEvents: "none" }}
            />
            <input
              type="text"
              className="panel-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entities, domains, files…"
              style={{ paddingLeft: 28 }}
              autoFocus
            />
          </div>
          <select
            className="panel-input"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          >
            <option value="">All domains</option>
            {domains.map((d) => (
              <option key={d.key} value={d.key}>
                {d.key === "__unassigned__" ? "Unassigned" : d.key} ({d.count})
              </option>
            ))}
          </select>
        </div>

        {/* Select-all row */}
        {filtered.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "4px 2px",
              fontSize: 11,
              color: "var(--text-tertiary)",
              borderBottom: "1px solid var(--border-default)",
            }}
          >
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: selectableKeys.length ? "pointer" : "not-allowed" }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={selectableKeys.length === 0}
              />
              <span>Select all visible</span>
            </label>
            <span>{filtered.length} shown</span>
          </div>
        )}

        {/* Entity list */}
        <div
          style={{
            maxHeight: 360,
            overflowY: "auto",
            border: "1px solid var(--border-default)",
            borderRadius: 6,
            background: "var(--bg-1)",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: 20, fontSize: 12, color: "var(--text-tertiary)", textAlign: "center" }}>
              {candidates.length === 0
                ? "No model YAML files found in this project yet."
                : "No entities match your filter."}
            </div>
          ) : (
            filtered.map((c) => {
              const key = `${c.file}::${c.name}`;
              const disabled = isOnDiagram(c);
              const checked = selected.has(key);
              return (
                <label
                  key={key}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderBottom: "1px solid var(--border-default)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    background: checked ? "var(--accent-dim)" : "transparent",
                    opacity: disabled ? 0.55 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(key)}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.name}
                      {disabled && (
                        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 500, color: "var(--text-tertiary)" }}>
                          · already on diagram
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-tertiary)",
                        fontFamily: "var(--font-mono, ui-monospace, Menlo, monospace)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.file}
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-tertiary)", textAlign: "right", whiteSpace: "nowrap" }}>
                    {c.subject_area || "—"}
                  </div>
                </label>
              );
            })
          )}
        </div>

        {error && (
          <div className="dlx-modal-alert">
            <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
