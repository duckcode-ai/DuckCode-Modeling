import React, { useMemo, useState } from "react";
import yaml from "js-yaml";
import { AlertCircle, Braces, Search } from "lucide-react";
import Modal from "./Modal";
import useUiStore from "../../stores/uiStore";
import useWorkspaceStore from "../../stores/workspaceStore";

const DIAGRAM_RE = /\.diagram\.ya?ml$/i;
const YAML_RE = /\.ya?ml$/i;

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^[/\\]+/, "");
}

function parseDiagramFileRefs(content) {
  if (!content || typeof content !== "string") return new Set();
  try {
    const doc = yaml.load(content);
    const refs = new Set();
    (Array.isArray(doc?.entities) ? doc.entities : []).forEach((entry) => {
      const file = normalizePath(entry?.file);
      if (file) refs.add(file);
    });
    return refs;
  } catch (_err) {
    return new Set();
  }
}

function summarizeYaml(content) {
  if (!content || typeof content !== "string") return { kind: "", entities: 0 };
  try {
    const doc = yaml.load(content);
    if (!doc || typeof doc !== "object") return { kind: "", entities: 0 };
    if (Array.isArray(doc.models) || Array.isArray(doc.sources)) {
      const modelCount = Array.isArray(doc.models) ? doc.models.length : 0;
      const sourceCount = Array.isArray(doc.sources)
        ? doc.sources.reduce((count, source) => count + (Array.isArray(source?.tables) ? source.tables.length : 0), 0)
        : 0;
      return { kind: "dbt", entities: modelCount + sourceCount };
    }
    const docKind = String(doc.kind || "").toLowerCase();
    if (docKind === "model") return { kind: "model", entities: 1 };
    if (docKind === "source") {
      const tables = Array.isArray(doc.tables) ? doc.tables.length : (doc.name ? 1 : 0);
      return { kind: "source", entities: tables || 1 };
    }
    return { kind: "", entities: 0 };
  } catch (_err) {
    return { kind: "", entities: 0 };
  }
}

function inferKindFromPath(fullPath, name) {
  const path = normalizePath(fullPath).toLowerCase();
  const fileName = String(name || "").toLowerCase();
  if (/dbt_project\.ya?ml$/i.test(fileName)) return "project";
  if (/schema\.ya?ml$/i.test(fileName)) return "dbt";
  if (/^models\//i.test(path)) return "dbt";
  if (/^seeds\//i.test(path)) return "seed";
  if (/^snapshots\//i.test(path)) return "snapshot";
  if (/^analyses\//i.test(path)) return "analysis";
  if (/^macros\//i.test(path)) return "macro";
  return "";
}

export default function DbtYamlPickerDialog() {
  const { closeModal, addToast, modalPayload } = useUiStore();
  const projectFiles = useWorkspaceStore((s) => s.projectFiles);
  const fileContentCache = useWorkspaceStore((s) => s.fileContentCache);
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const addDiagramReferences = useWorkspaceStore((s) => s.addDiagramReferences);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const isDiagram = !!activeFile && DIAGRAM_RE.test(String(activeFile.name || activeFile.path || ""));
  const existingRefs = useMemo(() => parseDiagramFileRefs(activeFileContent), [activeFileContent]);

  const candidates = useMemo(() => {
    return (projectFiles || [])
      .map((file) => {
        const fullPath = normalizePath(file?.fullPath || file?.path || "");
        const name = String(file?.name || fullPath.split("/").pop() || "");
        if (!fullPath || !YAML_RE.test(name) || DIAGRAM_RE.test(name)) return null;
        const content = (typeof file?.content === "string" ? file.content : null)
          ?? fileContentCache?.[fullPath]
          ?? null;
        const summary = summarizeYaml(content);
        const inferredKind = inferKindFromPath(fullPath, name);
        if (!inferredKind && !summary.kind) return null;
        return {
          path: fullPath,
          name,
          summary: {
            kind: summary.kind || inferredKind,
            entities: summary.entities,
          },
          alreadyAdded: existingRefs.has(fullPath),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [existingRefs, fileContentCache, projectFiles]);

  const filtered = useMemo(() => {
    const needle = String(search || "").trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((item) => `${item.name} ${item.path}`.toLowerCase().includes(needle));
  }, [candidates, search]);

  const selectable = filtered.filter((item) => !item.alreadyAdded);
  const allSelected = selectable.length > 0 && selectable.every((item) => selected.has(item.path));

  const toggle = (path) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) selectable.forEach((item) => next.delete(item.path));
      else selectable.forEach((item) => next.add(item.path));
      return next;
    });
  };

  const submit = async () => {
    if (!isDiagram) {
      setError("Open a .diagram.yaml file first.");
      return;
    }
    if (!selected.size) return;
    setSubmitting(true);
    setError("");
    try {
      const baseX = Number.isFinite(Number(modalPayload?.x)) ? Number(modalPayload.x) : 120;
      const baseY = Number.isFinite(Number(modalPayload?.y)) ? Number(modalPayload.y) : 120;
      const entries = Array.from(selected).map((path, index) => ({
        file: path,
        entity: "*",
        x: baseX + (index % 4) * 300,
        y: baseY + Math.floor(index / 4) * 220,
      }));
      await addDiagramReferences(entries);
      addToast({
        type: "success",
        message: `Added ${entries.length} dbt YAML ${entries.length === 1 ? "file" : "files"} to diagram.`,
      });
      closeModal();
    } catch (err) {
      setError(String(err?.message || err || "Failed to add dbt YAML."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isDiagram) {
    return (
      <Modal
        icon={<Braces size={14} />}
        title="Add dbt YAML"
        size="md"
        onClose={closeModal}
        footer={<button type="button" className="panel-btn" onClick={closeModal}>Close</button>}
      >
        <div className="dlx-modal-alert">
          <AlertCircle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>Open a <code>.diagram.yaml</code> file before adding dbt YAML.</span>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      icon={<Braces size={14} />}
      title="Add dbt YAML to physical diagram"
      subtitle="Search existing dbt YAML files in the current workspace and add them to this diagram."
      size="lg"
      onClose={closeModal}
      footerStatus={selected.size ? `${selected.size} selected` : `${filtered.length} matching files`}
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
      <div style={{ display: "grid", gap: 10 }}>
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
            placeholder="Search by file name or path…"
            style={{ paddingLeft: 28 }}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text-secondary)" }}>
          <span>{filtered.length} files</span>
          <button
            type="button"
            className="panel-btn"
            onClick={toggleAll}
            disabled={selectable.length === 0}
            style={{ padding: "4px 8px" }}
          >
            {allSelected ? "Clear visible" : "Select visible"}
          </button>
        </div>

        <div style={{ maxHeight: 420, overflow: "auto", display: "grid", gap: 8 }}>
          {filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-tertiary)", padding: "10px 2px" }}>
              No matching dbt YAML files found.
            </div>
          ) : filtered.map((item) => {
            const checked = selected.has(item.path);
            return (
              <label
                key={item.path}
                style={{
                  display: "grid",
                  gridTemplateColumns: "16px 1fr auto",
                  gap: 10,
                  alignItems: "start",
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: checked ? "rgba(79,70,229,0.10)" : "var(--bg-1)",
                  opacity: item.alreadyAdded ? 0.6 : 1,
                  cursor: item.alreadyAdded ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={item.alreadyAdded}
                  onChange={() => toggle(item.path)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{item.name}</div>
                  <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
                    {item.path}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {item.summary.kind && <span className="status-pill tone-neutral">{item.summary.kind}</span>}
                  {item.summary.entities > 0 && <span className="status-pill tone-info">{item.summary.entities} objects</span>}
                  {item.alreadyAdded && <span className="status-pill tone-warning">Already on diagram</span>}
                </div>
              </label>
            );
          })}
        </div>

        {error ? <div className="dlx-modal-alert error">{error}</div> : null}
      </div>
    </Modal>
  );
}
