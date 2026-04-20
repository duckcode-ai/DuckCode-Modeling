/* LibrariesPanel — manages reusable building blocks for the model:
   domains, enums, templates, subject areas, and naming rules.

   Re-laid out on top of the shared .panel-form-* primitives so every
   input, select, button, and chip list renders through one coherent
   Luna-aware style (no legacy bg-bg-primary / text-text-muted classes,
   no native unstyled dropdowns). Each section has a proper two-column
   field grid, aligned labels, and a single primary action. Summary
   counters live inside PanelCards for consistent borders and shadows
   across midnight / obsidian / paper / arctic. */
import React, { useMemo, useState } from "react";
import yaml from "js-yaml";
import {
  BookMarked, Package2, Tag, CaseUpper, Library, Plus,
} from "lucide-react";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useAuthStore from "../../stores/authStore";
import {
  addDomain, addEnum, addSubjectArea, addTemplate, setNamingRule,
} from "../../lib/yamlRoundTrip";
import { PanelFrame, PanelSection } from "./PanelFrame";

const NAMING_TARGETS = ["entity", "field", "relationship", "physical_name", "index"];
const NAMING_STYLES = ["pascal_case", "snake_case", "lower_snake_case", "upper_snake_case"];
const DATA_TYPES = ["string", "integer", "decimal", "boolean", "date", "datetime", "timestamp", "uuid", "json"];

/* Little summary counter used at the top of the panel. */
function SummaryCard({ label, value }) {
  return (
    <div className="panel-summary-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

/* Chip list row — renders existing items or a dashed placeholder. */
function ChipList({ items, empty = "None yet" }) {
  if (!items || items.length === 0) {
    return (
      <div className="panel-chip-list">
        <span className="panel-chip empty">{empty}</span>
      </div>
    );
  }
  return (
    <div className="panel-chip-list">
      {items.map((it) => (
        <span key={it.key || it.name} className="panel-chip" title={it.title || it.name}>
          {it.name}
          {it.sub && (
            <span style={{ color: "var(--text-tertiary)", marginLeft: 6 }}>{it.sub}</span>
          )}
        </span>
      ))}
    </div>
  );
}

export default function LibrariesPanel() {
  const { activeFileContent, updateContent } = useWorkspaceStore();
  const { addToast } = useUiStore();
  const { canEdit: canEditFn } = useAuthStore();
  const canEdit = canEditFn();

  const [domainName, setDomainName] = useState("");
  const [domainType, setDomainType] = useState("string");
  const [enumName, setEnumName] = useState("");
  const [enumValues, setEnumValues] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [subjectAreaName, setSubjectAreaName] = useState("");
  const [namingTarget, setNamingTarget] = useState("entity");
  const [namingStyle, setNamingStyle] = useState("pascal_case");
  const [namingPattern, setNamingPattern] = useState("");

  const doc = useMemo(() => {
    try {
      return activeFileContent ? yaml.load(activeFileContent) || {} : {};
    } catch (_err) {
      return {};
    }
  }, [activeFileContent]);

  const domains = Array.isArray(doc.domains) ? doc.domains : [];
  const enums = Array.isArray(doc.enums) ? doc.enums : [];
  const templates = Array.isArray(doc.templates) ? doc.templates : [];
  const subjectAreas = Array.isArray(doc.subject_areas) ? doc.subject_areas : [];
  const namingRules = doc.naming_rules && typeof doc.naming_rules === "object" ? doc.naming_rules : {};

  const applyMutation = (result, successMessage, reset) => {
    if (result.error) {
      addToast?.({ type: "error", message: result.error });
      return;
    }
    updateContent(result.yaml);
    reset?.();
    addToast?.({ type: "success", message: successMessage });
  };

  return (
    <PanelFrame
      icon={<Library size={14} />}
      eyebrow="Reusables"
      title="Libraries"
      subtitle={`${domains.length} domains · ${enums.length} enums · ${templates.length} templates · ${subjectAreas.length} subject areas`}
    >
      {/* Summary counters ─────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <SummaryCard label="Domains" value={domains.length} />
        <SummaryCard label="Enums" value={enums.length} />
        <SummaryCard label="Templates" value={templates.length} />
        <SummaryCard label="Subject Areas" value={subjectAreas.length} />
      </div>

      {/* Domain Library ───────────────────────────────────────────── */}
      <PanelSection
        title="Domain Library"
        icon={<BookMarked size={11} />}
        description="Reusable data-type / semantic-type definitions referenced by entity fields."
      >
        <div className="panel-form-grid">
          <div className="panel-form-row">
            <label className="panel-form-label">Name</label>
            <input
              className="panel-input"
              value={domainName}
              onChange={(e) => setDomainName(e.target.value)}
              placeholder="e.g. money_usd"
              disabled={!canEdit}
            />
          </div>
          <div className="panel-form-row">
            <label className="panel-form-label">Data Type</label>
            <select
              className="panel-select"
              value={domainType}
              onChange={(e) => setDomainType(e.target.value)}
              disabled={!canEdit}
            >
              {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="panel-btn-row" style={{ marginTop: 10 }}>
          <button
            className="panel-btn primary"
            disabled={!canEdit || !domainName.trim()}
            onClick={() =>
              applyMutation(
                addDomain(activeFileContent, domainName, domainType),
                "Added domain.",
                () => { setDomainName(""); setDomainType("string"); }
              )
            }
          >
            <Plus size={11} /> Add Domain
          </button>
        </div>
        <ChipList
          empty="No domains defined yet"
          items={domains.map((d) => ({ name: d.name, sub: d.type, title: `${d.name} : ${d.type || "string"}` }))}
        />
      </PanelSection>

      {/* Enums and Templates ──────────────────────────────────────── */}
      <PanelSection
        title="Enums & Templates"
        icon={<Tag size={11} />}
        description="Enumerations are reusable value sets; templates are reusable entity scaffolds."
      >
        <div className="panel-form-grid">
          <div className="panel-form-row">
            <label className="panel-form-label">Enum Name</label>
            <input
              className="panel-input"
              value={enumName}
              onChange={(e) => setEnumName(e.target.value)}
              placeholder="e.g. order_status"
              disabled={!canEdit}
            />
          </div>
          <div className="panel-form-row">
            <label className="panel-form-label">Values</label>
            <input
              className="panel-input"
              value={enumValues}
              onChange={(e) => setEnumValues(e.target.value)}
              placeholder="draft, pending, shipped, cancelled"
              disabled={!canEdit}
            />
          </div>
        </div>
        <div className="panel-btn-row" style={{ marginTop: 10, marginBottom: 14 }}>
          <button
            className="panel-btn primary"
            disabled={!canEdit || !enumName.trim()}
            onClick={() =>
              applyMutation(
                addEnum(activeFileContent, enumName, enumValues),
                "Added enum.",
                () => { setEnumName(""); setEnumValues(""); }
              )
            }
          >
            <Plus size={11} /> Add Enum
          </button>
        </div>

        <div className="panel-form-grid">
          <div className="panel-form-row" style={{ gridColumn: "1 / -1" }}>
            <label className="panel-form-label">Template Name</label>
            <input
              className="panel-input"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. audited_entity"
              disabled={!canEdit}
            />
          </div>
        </div>
        <div className="panel-btn-row" style={{ marginTop: 10 }}>
          <button
            className="panel-btn"
            disabled={!canEdit || !templateName.trim()}
            onClick={() =>
              applyMutation(
                addTemplate(activeFileContent, templateName),
                "Added template.",
                () => setTemplateName("")
              )
            }
          >
            <Plus size={11} /> Add Template
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 10,
            marginTop: 14,
          }}
        >
          <div style={{
            padding: 10, borderRadius: 8,
            background: "var(--bg-1)", border: "1px solid var(--border-default)",
          }}>
            <div className="panel-form-label" style={{ marginBottom: 6 }}>Enums ({enums.length})</div>
            <ChipList empty="No enums yet" items={enums.map((e) => ({ name: e.name }))} />
          </div>
          <div style={{
            padding: 10, borderRadius: 8,
            background: "var(--bg-1)", border: "1px solid var(--border-default)",
          }}>
            <div className="panel-form-label" style={{ marginBottom: 6 }}>Templates ({templates.length})</div>
            <ChipList empty="No templates yet" items={templates.map((t) => ({ name: t.name }))} />
          </div>
        </div>
      </PanelSection>

      {/* Subject Areas ────────────────────────────────────────────── */}
      <PanelSection
        title="Subject Areas"
        icon={<Package2 size={11} />}
        description="Business-domain groupings that organise entities on the canvas."
      >
        <div className="panel-form-grid">
          <div className="panel-form-row" style={{ gridColumn: "1 / -1" }}>
            <label className="panel-form-label">Subject Area Name</label>
            <input
              className="panel-input"
              value={subjectAreaName}
              onChange={(e) => setSubjectAreaName(e.target.value)}
              placeholder="e.g. billing"
              disabled={!canEdit}
            />
          </div>
        </div>
        <div className="panel-btn-row" style={{ marginTop: 10 }}>
          <button
            className="panel-btn primary"
            disabled={!canEdit || !subjectAreaName.trim()}
            onClick={() =>
              applyMutation(
                addSubjectArea(activeFileContent, subjectAreaName),
                "Added subject area.",
                () => setSubjectAreaName("")
              )
            }
          >
            <Plus size={11} /> Add Subject Area
          </button>
        </div>
        <ChipList
          empty="No subject areas defined yet"
          items={subjectAreas.map((a) => ({ name: a.name }))}
        />
      </PanelSection>

      {/* Naming Rules ─────────────────────────────────────────────── */}
      <PanelSection
        title="Naming Rules"
        icon={<CaseUpper size={11} />}
        description="Enforce a naming convention per object type. Patterns are optional regex validation."
      >
        <div className="panel-form-grid">
          <div className="panel-form-row">
            <label className="panel-form-label">Target</label>
            <select
              className="panel-select"
              value={namingTarget}
              onChange={(e) => setNamingTarget(e.target.value)}
              disabled={!canEdit}
            >
              {NAMING_TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="panel-form-row">
            <label className="panel-form-label">Style</label>
            <select
              className="panel-select"
              value={namingStyle}
              onChange={(e) => setNamingStyle(e.target.value)}
              disabled={!canEdit}
            >
              {NAMING_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="panel-form-row" style={{ gridColumn: "1 / -1" }}>
            <label className="panel-form-label">Pattern (optional regex)</label>
            <input
              className="panel-input"
              value={namingPattern}
              onChange={(e) => setNamingPattern(e.target.value)}
              placeholder="e.g. ^[A-Z][a-zA-Z0-9]+$"
              disabled={!canEdit}
            />
          </div>
        </div>
        <div className="panel-btn-row" style={{ marginTop: 10 }}>
          <button
            className="panel-btn primary"
            disabled={!canEdit}
            onClick={() =>
              applyMutation(
                setNamingRule(activeFileContent, namingTarget, namingStyle, namingPattern),
                `Updated ${namingTarget} naming rule.`
              )
            }
          >
            Apply Rule
          </button>
        </div>

        {/* Existing rules table */}
        <div style={{ marginTop: 14 }}>
          <div className="panel-form-label" style={{ marginBottom: 6 }}>Current Rules</div>
          <table className="panel-table">
            <thead>
              <tr>
                <th style={{ width: "28%" }}>Target</th>
                <th style={{ width: "32%" }}>Style</th>
                <th>Pattern</th>
              </tr>
            </thead>
            <tbody>
              {NAMING_TARGETS.map((target) => {
                const rule = namingRules[target];
                return (
                  <tr key={target}>
                    <td style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{target}</td>
                    <td style={{ color: rule?.style ? "var(--text-primary)" : "var(--text-tertiary)" }}>
                      {rule?.style || "unset"}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", color: "var(--text-tertiary)" }}>
                      {rule?.pattern || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </PanelSection>
    </PanelFrame>
  );
}
