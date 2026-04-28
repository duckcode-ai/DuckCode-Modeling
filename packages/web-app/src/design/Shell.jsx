/* DataLex shell — integrated root. Combines the Luna-class visual design
   (topbar / project tabs / left / canvas / right / status) with the full
   DataLex feature set (real projects from the api-server, bottom drawer
   with all legacy panels, all existing dialogs, keyboard shortcuts).

   This file replaces App.jsx. Visual layout comes from datalex-design.css;
   the bottom-drawer row + dirty dot come from datalex-integration.css. */
import React, { useEffect, useState } from "react";
import {
  Columns3, ShieldCheck, GitCompare, Clock, X,
  BookOpen, ChevronUp, Wand2, KeyRound, GitBranch, Database, FileCode2, Braces, Copy,
  Camera, Eye, FlaskConical, Shield,
} from "lucide-react";

import yaml from "js-yaml";
import { TopBar, ProjectTabs, StatusBar } from "./Chrome";
import LeftPanel from "./LeftPanel";
import Canvas from "./Canvas";
import RightPanel from "./RightPanel";
import CommandPalette from "./CommandPalette";
import BottomDrawer from "./BottomDrawer";
import { DEMO_SCHEMA } from "./demoSchema";
import { THEMES } from "./notation";
import { adaptDataLexYaml, adaptDataLexModelYaml, adaptDbtSchemaYaml, adaptDiagramYaml, schemaToPanelModel } from "./schemaAdapter";
import { appendEntity, addDiagramRelationship, deleteDiagramEntity, deleteEntityDeep, removeFieldRelationship, setEntityDisplay, setDiagramEntityDisplay, setInlineDiagramEntityDisplay } from "./yamlPatch";
import { addRelationship, deleteRelationship as deleteRelationshipYaml } from "../lib/yamlRoundTrip";
import { shouldShowFirstRun, markTourSeen } from "../lib/onboardingTour";
import { shouldShowJourney, emitJourneyEvent } from "../lib/onboardingJourney";
import { fetchGitStatus, aiConceptualize } from "../lib/api";
import {
  AddProjectModal,
  EditProjectModal,
  NewFileModal,
} from "../components/dialogs/ProjectModals";
import KeyboardShortcutsPanel from "../components/panels/KeyboardShortcutsPanel";
import AiProposalPreview from "../components/ai/AiProposalPreview";
import { proposalChangeFromYaml, proposalEditableYaml, proposalEditorTitle } from "../components/ai/aiProposalYaml";

// Heavy panels / dialogs are split into separate chunks — they only load when
// the user actually opens them, which keeps the initial JS bundle small.
const ValidationPanel     = React.lazy(() => import("../components/panels/ValidationPanel"));
const DiffPanel           = React.lazy(() => import("../components/panels/DiffPanel"));
const HistoryPanel        = React.lazy(() => import("../components/panels/HistoryPanel"));
const DictionaryPanel     = React.lazy(() => import("../components/panels/DictionaryPanel"));
// P1.B — read-only panels for non-model dbt resources surfaced from the active YAML.
const SnapshotsPanel      = React.lazy(() => import("../components/panels/SnapshotsPanel"));
const ExposuresPanel      = React.lazy(() => import("../components/panels/ExposuresPanel"));
const UnitTestsPanel      = React.lazy(() => import("../components/panels/UnitTestsPanel"));
// P0.3 — custom policy pack editor for <project>/.datalex/policies/.
const PolicyPacksPanel    = React.lazy(() => import("../components/panels/PolicyPacksPanel"));
const SelectionSummaryPanel = React.lazy(() => import("../components/panels/SelectionSummaryPanel"));
const ModelerPanel        = React.lazy(() => import("../components/panels/ModelerPanel"));
const SettingsDialog      = React.lazy(() => import("../components/dialogs/SettingsDialog"));
const ConnectionsManager  = React.lazy(() => import("../components/dialogs/ConnectionsManager"));
const CommitDialog        = React.lazy(() => import("../components/dialogs/CommitDialog"));
const ExportDdlDialog     = React.lazy(() => import("../components/dialogs/ExportDdlDialog"));
const ApplyDdlDialog      = React.lazy(() => import("../components/dialogs/ApplyDdlDialog"));
const PanelDialog         = React.lazy(() => import("../components/dialogs/PanelDialog"));
const GitBranchDialog     = React.lazy(() => import("../components/dialogs/GitBranchDialog"));
const ImportDbtRepoDialog = React.lazy(() => import("../components/dialogs/ImportDbtRepoDialog"));
const DbtYamlPickerDialog = React.lazy(() => import("../components/dialogs/DbtYamlPickerDialog"));
const NewRelationshipDialog = React.lazy(() => import("../components/dialogs/NewRelationshipDialog"));
const NewConceptDialog    = React.lazy(() => import("../components/dialogs/NewConceptDialog"));
const NewLogicalEntityDialog = React.lazy(() => import("../components/dialogs/NewLogicalEntityDialog"));
const EntityPickerDialog  = React.lazy(() => import("../components/dialogs/EntityPickerDialog"));
const BulkRenameColumnDialog = React.lazy(() => import("../components/dialogs/BulkRenameColumnDialog"));
const ShareBundleDialog   = React.lazy(() => import("../components/dialogs/ShareBundleDialog"));
const AiAssistantDialog   = React.lazy(() => import("../components/dialogs/AiAssistantDialog"));

function normalizeWorkspaceFileRef(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^[/\\]+/, "");
}

function parseDbtEntityRef(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const ref = text.match(/ref\(\s*['"]([^'"]+)['"]\s*\)/i);
  if (ref) return String(ref[1] || "").trim() || null;
  const source = text.match(/source\(\s*['"][^'"]+['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
  if (source) return String(source[1] || "").trim() || null;
  return null;
}

function collectSemanticDependencyNames(yamlText) {
  try {
    const doc = yaml.load(yamlText);
    if (!doc || typeof doc !== "object") return [];
    const names = [];
    const seen = new Set();
    (Array.isArray(doc.semantic_models) ? doc.semantic_models : []).forEach((model) => {
      const ref = parseDbtEntityRef(model?.model);
      const key = String(ref || "").toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      names.push(ref);
    });
    return names;
  } catch (_err) {
    return [];
  }
}

function resolveSemanticDependencyPaths(projectFiles, entityNames) {
  const wanted = new Set((entityNames || []).map((name) => String(name || "").toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return [];
  const paths = [];
  const seen = new Set();
  (projectFiles || []).forEach((file) => {
    const rawPath = normalizeWorkspaceFileRef(file?.fullPath || file?.path || "");
    if (!rawPath || !/\.ya?ml$/i.test(rawPath)) return;
    const base = rawPath.split("/").pop()?.replace(/\.ya?ml$/i, "").toLowerCase();
    if (!base || !wanted.has(base) || seen.has(rawPath)) return;
    seen.add(rawPath);
    paths.push(rawPath);
  });
  return paths;
}

function inferRelationshipCardinality(fromCol, toCol) {
  const fromOne = !!(fromCol?.pk || fromCol?.unique);
  const toOne = !!(toCol?.pk || toCol?.unique);
  if (fromOne && toOne) return "one_to_one";
  if (fromOne && !toOne) return "one_to_many";
  if (!fromOne && toOne) return "many_to_one";
  return "many_to_many";
}

function defaultRelationshipName(fromEntity, toEntity) {
  const clean = (value) => String(value || "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${clean(fromEntity)}_to_${clean(toEntity)}`.toLowerCase() || "new_relationship";
}
const SnapshotsDialog     = React.lazy(() => import("../components/dialogs/SnapshotsDialog"));
const ViewerWelcome       = React.lazy(() => import("../components/viewer/ViewerWelcome"));
const OnboardingJourney   = React.lazy(() => import("../components/onboarding/OnboardingJourney"));

// The three main-canvas alternatives to the diagram. Lazy-loaded so the
// initial bundle stays tight when the user only ever uses the diagram.
const TableView           = React.lazy(() => import("./views/TableView"));
const ViewsView           = React.lazy(() => import("./views/ViewsView"));
const EnumsView           = React.lazy(() => import("./views/EnumsView"));
const DocsView            = React.lazy(() => import("../components/docs/DocsView"));

import useWorkspaceStore from "../stores/workspaceStore";
import useAuthStore from "../stores/authStore";
import useUiStore from "../stores/uiStore";
import useDiagramStore from "../stores/diagramStore";

import "../styles/datalex-design.css";
import "../styles/datalex-integration.css";

const THEME_STORAGE = "datalex.theme";
const DENSITY_STORAGE = "datalex.density";
const LEFT_PANEL_WIDTH_STORAGE = "datalex.leftPanelWidth";
const LEFT_PANEL_MIN = 220;
const LEFT_PANEL_MAX = 520;

/* Bottom-drawer tab order. The leftmost tab is the default when no
   persisted choice is in scope — so Validation comes first to make
   "what's broken / missing" the answer the user sees on open. After
   that, the order follows the typical "edit → preview → test → diff"
   workflow: SQL Preview, Unit Tests, then Diff. Authoring tools
   (Studio, dbt YAML, Constraints, etc.) and reference panels
   (Snapshots, Exposures, Policy Packs, History) sit further right. */
const LOGICAL_BOTTOM_TABS = [
  { id: "validation",    label: "Validation",    icon: ShieldCheck },
  { id: "diff",          label: "Diff",          icon: GitCompare },
  { id: "modeler",       label: "Blueprint",     icon: Wand2 },
  { id: "policy_packs",  label: "Policy Packs",  icon: Shield },
  { id: "history",       label: "History",       icon: Clock },
];

const PHYSICAL_BOTTOM_TABS = [
  { id: "validation",    label: "Validation",    icon: ShieldCheck },
  { id: "sql",           label: "SQL Preview",   icon: FileCode2 },
  { id: "unit_tests",    label: "Unit Tests",    icon: FlaskConical },
  { id: "diff",          label: "Diff",          icon: GitCompare },
  { id: "modeler",       label: "Studio",        icon: Wand2 },
  { id: "dbt",           label: "dbt YAML",      icon: Braces },
  { id: "constraints",   label: "Constraints",   icon: Database },
  { id: "snapshots",     label: "Snapshots",     icon: Camera },
  { id: "exposures",     label: "Exposures",     icon: Eye },
  { id: "policy_packs",  label: "Policy Packs",  icon: Shield },
];

const CONCEPTUAL_BOTTOM_TABS = [
  { id: "validation",    label: "Validation",    icon: ShieldCheck },
  { id: "modeler",       label: "Studio",        icon: Wand2 },
  { id: "dictionary",    label: "Dictionary",    icon: BookOpen },
  { id: "relationships", label: "Relationships", icon: GitBranch },
  { id: "history",       label: "History",       icon: Clock },
];

const VIEWER_BOTTOM_TABS = [
  { id: "properties",    label: "Properties",    icon: Columns3 },
  { id: "dictionary",    label: "Dictionary",    icon: BookOpen },
  { id: "history",       label: "History",       icon: Clock },
];

const LazyFallback = (
  <div style={{ padding: 20, fontSize: 12, color: "var(--text-tertiary)" }}>Loading…</div>
);

function LayerSupportPanel({ title, eyebrow, description, table, rel, relationships, schema, activeFile, isDiagramFile }) {
  const tables = Array.isArray(schema?.tables) ? schema.tables : [];
  const rels = Array.isArray(schema?.relationships) ? schema.relationships : [];
  const selected = table || null;
  const columns = Array.isArray(selected?.columns) ? selected.columns : [];
  const candidateKeys = Array.isArray(selected?.candidate_keys) ? selected.candidate_keys : [];
  const businessKeys = Array.isArray(selected?.business_keys) ? selected.business_keys : [];
  return (
    <div style={{ padding: 16, display: "grid", gap: 12, color: "var(--text-primary)" }}>
      <div>
        <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>{eyebrow}</div>
        <div style={{ marginTop: 2, fontSize: 15, fontWeight: 700 }}>{title}</div>
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45 }}>{description}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {[
          ["Active file", activeFile?.name || activeFile?.path || "No file"],
          ["Layer", schema?.modelKind || "physical"],
          ["Objects", String(tables.length)],
          ["Relationships", String(rels.length)],
        ].map(([label, value]) => (
          <div key={label} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-1)", minWidth: 0 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)" }}>{label}</div>
            <div style={{ marginTop: 3, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
          </div>
        ))}
      </div>
      {selected && (
        <div style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: 12, background: "var(--bg-1)" }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{selected.name}</div>
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap", fontSize: 10 }}>
            {candidateKeys.length > 0 && <span className="status-pill tone-info">{candidateKeys.length} candidate key{candidateKeys.length === 1 ? "" : "s"}</span>}
            {businessKeys.length > 0 && <span className="status-pill tone-accent">{businessKeys.length} business key{businessKeys.length === 1 ? "" : "s"}</span>}
            {selected.surrogate_key && <span className="status-pill tone-neutral">Surrogate key</span>}
            {selected.subtype_of && <span className="status-pill tone-warning">Subtype of {selected.subtype_of}</span>}
            {isDiagramFile && <span className="status-pill tone-neutral">Diagram scoped</span>}
          </div>
          {columns.length > 0 && (
            <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
              {columns.slice(0, 8).map((column) => (
                <div key={column.name} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, fontSize: 11, color: "var(--text-secondary)" }}>
                  <span>{column.name}</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{column.type || "untyped"}{column.pk ? " PK" : ""}{column.fk ? " FK" : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {rel && (
        <div style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: 12, background: "var(--bg-1)", fontSize: 12 }}>
          {rel.name}: {rel.from?.table}{rel.from?.col ? `.${rel.from.col}` : ""}{" -> "}{rel.to?.table}{rel.to?.col ? `.${rel.to.col}` : ""}
        </div>
      )}
    </div>
  );
}

function AiPlanReviewEditor({ document, onClose }) {
  const content = String(document?.content || "");
  const proposals = Array.isArray(document?.proposals) ? document.proposals : [];
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [drafts, setDrafts] = React.useState(() => proposals.map((proposal) => proposal.editor_yaml || proposalEditableYaml(proposal)));
  const [validation, setValidation] = React.useState(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");
  React.useEffect(() => {
    setActiveIndex(0);
    setDrafts(proposals.map((proposal) => proposal.editor_yaml || proposalEditableYaml(proposal)));
    setValidation(null);
    setError("");
    setBusy("");
  }, [document]);
  const activeProposal = proposals[activeIndex] || null;
  const activeDraft = drafts[activeIndex] || "";
  const draftChanges = React.useMemo(
    () => proposals.map((proposal, index) => proposalChangeFromYaml(proposal, drafts[index] || "")),
    [drafts, proposals]
  );
  const activePreviewChange = activeProposal ? proposalChangeFromYaml(activeProposal, activeDraft) : null;
  const setActiveDraft = (value) => {
    setDrafts((items) => items.map((item, index) => index === activeIndex ? value : item));
    setValidation(null);
    setError("");
  };
  const copy = React.useCallback(() => {
    navigator.clipboard?.writeText(activeDraft || content).catch(() => {});
  }, [activeDraft, content]);
  const validateDrafts = async () => {
    if (!document?.onValidate || proposals.length === 0) return;
    setBusy("validate");
    setError("");
    try {
      const response = await document.onValidate(draftChanges);
      setValidation(response);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy("");
    }
  };
  const applyDrafts = async () => {
    if (!document?.onApply || proposals.length === 0) return;
    setBusy("apply");
    setError("");
    try {
      await document.onApply(draftChanges);
    } catch (err) {
      setError(err?.message || String(err));
      setBusy("");
    }
  };
  if (!document) return null;
  return (
    <section className="ai-plan-editor-shell" aria-label="AI review plan">
      <div className="ai-plan-editor-header">
        <div className="ai-plan-editor-title">
          <span>AI Review Plan</span>
          <strong>{document.title || "Proposal review"}</strong>
          {document.subtitle && <small>{document.subtitle}</small>}
        </div>
        <div className="ai-plan-editor-actions">
          {proposals.length > 0 && (
            <button type="button" className="panel-btn" onClick={validateDrafts} disabled={busy === "validate"}>
              {busy === "validate" ? "Validating..." : "Validate"}
            </button>
          )}
          {proposals.length > 0 && (
            <button type="button" className="panel-btn primary" onClick={applyDrafts} disabled={busy === "apply" || validation?.valid === false}>
              {busy === "apply" ? "Applying..." : `Apply ${proposals.length}`}
            </button>
          )}
          <button type="button" className="panel-btn" onClick={copy}>
            <Copy size={12} /> Copy
          </button>
          <button type="button" className="panel-btn" onClick={onClose}>
            <X size={12} /> Close
          </button>
        </div>
      </div>
      <div className="ai-plan-editor-body">
        {proposals.length > 0 && (
          <div className="ai-plan-proposal-tabs" role="tablist" aria-label="AI proposal files">
            {proposals.map((proposal, index) => (
              <button
                key={`${proposalEditorTitle(proposal, index)}-${index}`}
                type="button"
                className={`ai-plan-proposal-tab ${index === activeIndex ? "active" : ""}`}
                onClick={() => setActiveIndex(index)}
              >
                {proposalEditorTitle(proposal, index)}
              </button>
            ))}
          </div>
        )}
        {proposals.length > 0 ? (
          <div className="ai-plan-review-workspace">
            <div className="ai-plan-preview-grid">
              {activePreviewChange && <AiProposalPreview change={activePreviewChange} />}
            </div>
            <div className="ai-plan-yaml-pane">
              <div className="ai-plan-yaml-toolbar">
                <strong>Editable YAML</strong>
                <span>Modify the proposal, then validate and apply. The preview updates from this YAML.</span>
              </div>
              <textarea
                className="ai-plan-editor-text"
                value={activeDraft}
                onChange={(event) => setActiveDraft(event.target.value)}
                spellCheck={false}
              />
            </div>
          </div>
        ) : (
          <textarea
            className="ai-plan-editor-text"
            readOnly
            value={content}
            spellCheck={false}
          />
        )}
        {(validation || error) && (
          <div className={`ai-plan-validation ${validation?.valid ? "ok" : "bad"}`}>
            {error && <strong>{error}</strong>}
            {validation && (
              <>
                <strong>{validation.valid ? "Validation passed" : "Validation needs fixes"}</strong>
                <span>
                  {validation.summary?.valid || 0}/{validation.summary?.total || 0} valid,
                  {" "}{validation.summary?.errors || 0} errors,
                  {" "}{validation.summary?.warnings || 0} warnings
                </span>
                {(validation.results || []).flatMap((item) => item.errors || []).slice(0, 5).map((item, index) => (
                  <small key={`err-${index}`}>{item.message}</small>
                ))}
                {(validation.results || []).flatMap((item) => item.warnings || []).slice(0, 5).map((item, index) => (
                  <small key={`warn-${index}`}>{item}</small>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function BottomPanelContent({ tab, table, rel, relationships, schema, activeFile, isDiagramFile }) {
  let node;
  switch (tab) {
    case "modeler":       node = <ModelerPanel />; break;
    case "attributes":
      node = <LayerSupportPanel title="Logical Attributes" eyebrow="Logical" description="Define platform-neutral attributes, logical data types, nullability, and rules before physical dbt generation." table={table} rel={rel} relationships={relationships} schema={schema} activeFile={activeFile} isDiagramFile={isDiagramFile} />;
      break;
    case "keys":
      node = <LayerSupportPanel title="Keys" eyebrow="Logical" description="Review primary, foreign, alternate, candidate, composite, business, natural, surrogate, and hash key intent for the selected entity." table={table} rel={rel} relationships={relationships} schema={schema} activeFile={activeFile} isDiagramFile={isDiagramFile} />;
      break;
    case "relationships":
      node = <LayerSupportPanel title="Relationships" eyebrow={schema?.modelKind || "Model"} description="Review relationship meaning, role names, cardinality, optionality, identifying status, and diagram-scoped edges." table={table} rel={rel} relationships={relationships} schema={schema} activeFile={activeFile} isDiagramFile={isDiagramFile} />;
      break;
    case "dbt":
      node = <LayerSupportPanel title="dbt YAML" eyebrow="Physical" description="Physical diagrams are composed from dbt model/source YAML. Drag dbt YAML files from Explorer into this diagram and model constraints here." table={table} rel={rel} relationships={relationships} schema={schema} activeFile={activeFile} isDiagramFile={isDiagramFile} />;
      break;
    case "sql":
      node = <LayerSupportPanel title="SQL Preview" eyebrow="Physical" description="Generate or export SQL from physical dbt-backed diagrams. Logical diagrams can stage generated dbt SQL/YAML under generated-sql/ and the active domain folder." table={table} rel={rel} relationships={relationships} schema={schema} activeFile={activeFile} isDiagramFile={isDiagramFile} />;
      break;
    case "constraints":
      node = <LayerSupportPanel title="Constraints" eyebrow="Physical" description="Review physical names, dialect data types, PK/FK/AK flags, relationship tests, nullability, and generated constraint readiness." table={table} rel={rel} relationships={relationships} schema={schema} activeFile={activeFile} isDiagramFile={isDiagramFile} />;
      break;
    case "properties":
      node = (
        <SelectionSummaryPanel
          table={table}
          rel={rel}
          relationships={relationships}
          schema={schema}
          activeFile={activeFile}
          isDiagramFile={isDiagramFile}
        />
      );
      break;
    case "validation":    node = <ValidationPanel />; break;
    case "diff":          node = <DiffPanel />; break;
    case "dictionary":    node = <DictionaryPanel />; break;
    case "history":       node = <HistoryPanel />; break;
    case "snapshots":     node = <SnapshotsPanel />; break;
    case "exposures":     node = <ExposuresPanel />; break;
    case "unit_tests":    node = <UnitTestsPanel />; break;
    case "policy_packs":  node = <PolicyPacksPanel />; break;
    default:
      node = (
        <SelectionSummaryPanel
          table={table}
          rel={rel}
          relationships={relationships}
          schema={schema}
          activeFile={activeFile}
          isDiagramFile={isDiagramFile}
        />
      );
  }
  return <React.Suspense fallback={LazyFallback}>{node}</React.Suspense>;
}

function WelcomeModal({ onClose }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 92vw)", maxHeight: "85vh", overflow: "auto",
          background: "var(--bg-2)", border: "1px solid var(--border-strong)",
          borderRadius: 12, boxShadow: "var(--shadow-pop)", position: "relative",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 10, right: 10, zIndex: 1,
            background: "transparent", border: "none", color: "var(--text-tertiary)",
            cursor: "pointer", padding: 6, borderRadius: 6,
          }}
          title="Close"
        >
          <X size={16} />
        </button>
        <React.Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "var(--text-tertiary)" }}>Loading…</div>}>
          <ViewerWelcome />
        </React.Suspense>
      </div>
    </div>
  );
}

function ToastContainer() {
  const { toasts, removeToast } = useUiStore();
  if (toasts.length === 0) return null;
  return (
    <div className="datalex-toasts">
      {toasts.map((toast) => (
        <div key={toast.id}
             style={{
               display: "flex", alignItems: "center", gap: 8,
               padding: "8px 12px", borderRadius: 8, fontSize: 12,
               background: toast.type === "error" ? "rgba(239,68,68,0.12)"
                         : toast.type === "success" ? "rgba(16,185,129,0.12)"
                         : "var(--bg-2)",
               border: `1px solid ${toast.type === "error" ? "rgba(239,68,68,0.4)"
                       : toast.type === "success" ? "rgba(16,185,129,0.4)"
                       : "var(--border-default)"}`,
               color: "var(--text-primary)",
               boxShadow: "var(--shadow-pop)",
               minWidth: 200,
             }}>
          <span style={{ flex: 1 }}>{toast.message}</span>
          <button onClick={() => removeToast(toast.id)}
                  style={{ background: "transparent", border: "none", color: "var(--text-tertiary)", cursor: "pointer", padding: 2 }}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Shell() {
  /* ── Theme + density ───────────────────────────────────────────── */
  const [theme, setTheme] = React.useState(() => localStorage.getItem(THEME_STORAGE) || "midnight");
  const [density, setDensity] = React.useState(() => localStorage.getItem(DENSITY_STORAGE) || "comfortable");

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_STORAGE, theme);
  }, [theme]);

  // External theme-change trigger — fired by SettingsDialog (and anywhere
  // else that mutates the theme directly) so the shell state stays in sync
  // with the DOM without either side needing to know about the other.
  React.useEffect(() => {
    const onExternal = (e) => {
      const next = e?.detail?.theme;
      if (next && THEMES.some((t) => t.id === next)) setTheme(next);
    };
    window.addEventListener("datalex:theme-change", onExternal);
    return () => window.removeEventListener("datalex:theme-change", onExternal);
  }, []);
  React.useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
    localStorage.setItem(DENSITY_STORAGE, density);
  }, [density]);

  const cycleTheme = React.useCallback(() => {
    const ids = THEMES.map((t) => t.id);
    setTheme((cur) => ids[(ids.indexOf(cur) + 1) % ids.length]);
  }, []);

  /* ── Identity (open-source: permissive stub, see stores/authStore.js) ── */
  const { canEdit } = useAuthStore();

  /* ── Workspace ─────────────────────────────────────────────────── */
  const {
    projects, activeProjectId, openProjects, openTabs, activeFile,
    activeFileContent, isDirty, loadProjects, selectProject, closeProject,
    cycleProject, saveCurrentFile, error, clearError,
    lastAutoGeneratedDdl, lastAutoGenerateError,
    projectFiles, fileContentCache, ensureFilesLoaded,
  } = useWorkspaceStore();

  useEffect(() => { loadProjects(); }, []);

  /* ── UI store (modals, bottom panel, selection, toasts, palette) ─ */
  const {
    activeModal, openModal, closeModal,
    bottomPanelOpen, bottomPanelTab, setBottomPanelTab, toggleBottomPanel,
    rightPanelOpen, rightPanelTab, rightPanelWidth, commandPaletteOpen, setCommandPaletteOpen,
    shellViewMode,
    openAiPanel,
    addToast,
    aiReviewDocument,
    closeAiReviewDocument,
  } = useUiStore();

  /* Keep the `--right-w` CSS var in sync with the store so the grid knows
     how wide the right slot is on first paint and after the drag-resize
     strip commits a new width. */
  React.useEffect(() => {
    document.documentElement.style.setProperty("--right-w", `${rightPanelWidth}px`);
  }, [rightPanelWidth]);

  const selectedEntityId = useDiagramStore((s) => s.selectedEntityId);
  const setGraph = useDiagramStore((s) => s.setGraph);
  const selectDiagramEntity = useDiagramStore((s) => s.selectEntity);
  const clearDiagramSelection = useDiagramStore((s) => s.clearSelection);

  /* ── Keyboard shortcuts (match legacy App.jsx behavior) ────────── */
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [textAiTarget, setTextAiTarget] = useState(null);

  /* ── First-run onboarding journey ──────────────────────────────────
     The journey panel walks the user through six concrete actions
     (welcome → connect → see gaps → design → AI key → ask AI). The
     legacy 13-step driver.js spotlight tour now lives behind the
     "Deep feature tour" button in Settings; we mark it seen up-front
     so it doesn't auto-fire on top of the journey. */
  const [showOnboarding, setShowOnboarding] = useState(false);
  React.useEffect(() => {
    const wantJourney = shouldShowJourney();
    // Suppress the legacy driver.js modal — the journey supersedes it.
    if (shouldShowFirstRun()) markTourSeen();
    if (wantJourney) {
      // Wait for the top-bar / explorer to mount before showing the
      // journey panel — the user needs something behind it to look at.
      const t = setTimeout(() => setShowOnboarding(true), 400);
      return () => clearTimeout(t);
    }
  }, []);
  useEffect(() => {
    const handler = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || e.target.isContentEditable;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key === "s") {
        e.preventDefault();
        (async () => {
          await useWorkspaceStore.getState().saveCurrentFile();
          const { lastAutoGeneratedDdl: gen, lastAutoGenerateError: genErr } = useWorkspaceStore.getState();
          if (gen) addToast({ type: "success", message: `Auto-generated DDL: ${gen}` });
          else if (genErr) addToast({ type: "error", message: `Auto DDL failed: ${genErr}` });
          else addToast({ type: "success", message: "Saved model." });
        })();
        return;
      }
      if (meta && e.key === "k") { e.preventDefault(); setCommandPaletteOpen(true); return; }
      if (meta && e.key === "j") { e.preventDefault(); toggleBottomPanel(); return; }
      // Undo / Redo. CodeMirror handles these when focused in the YAML
      // editor itself; we only intercept outside input targets so editing
      // text in the inspector keeps native undo behaviour.
      if (meta && !isInput && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        const ok = useWorkspaceStore.getState().undo();
        if (!ok) addToast({ type: "info", message: "Nothing to undo." });
        return;
      }
      if (meta && !isInput && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        const ok = useWorkspaceStore.getState().redo();
        if (!ok) addToast({ type: "info", message: "Nothing to redo." });
        return;
      }
      if (meta && e.shiftKey && (e.key === "t" || e.key === "T")) { e.preventDefault(); cycleTheme(); return; }
      // Cmd/Ctrl+Shift+E → Export diagram to PNG. The canvas toolbar has
      // the same action, but this shortcut makes it reachable without a
      // mouse trip to the overflow row. We query the React Flow root the
      // same way the toolbar does — falls back silently if no diagram is
      // mounted (e.g. the user is on the code-view tab).
      if (meta && e.shiftKey && (e.key === "e" || e.key === "E")) {
        const el = document.querySelector(".react-flow");
        if (!el) return;
        e.preventDefault();
        import("html-to-image").then(({ toPng }) => {
          toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 }).then((dataUrl) => {
            const a = document.createElement("a");
            a.href = dataUrl; a.download = "datalex-diagram.png"; a.click();
          });
        }).catch(() => addToast({ type: "error", message: "Export failed — html-to-image not loaded." }));
        return;
      }
      if (meta && e.key === "Tab") {
        const { openProjects: op } = useWorkspaceStore.getState();
        if (op.length > 1) { e.preventDefault(); cycleProject(e.shiftKey ? -1 : 1); return; }
      }
      if (meta && e.key === "w") {
        const ws = useWorkspaceStore.getState();
        if (ws.activeProjectId && ws.openProjects.length > 0) {
          e.preventDefault();
          if (ws.isDirty) {
            const p = ws.projects.find((x) => x.id === ws.activeProjectId);
            if (!window.confirm(`${p?.name || ws.activeProjectId} has unsaved changes. Close without saving?`)) return;
          }
          ws.closeProject(ws.activeProjectId);
          return;
        }
      }
      if (!isInput && e.key === "?") { setShowShortcuts((v) => !v); return; }
      if (e.key === "Escape" && showShortcuts) { setShowShortcuts(false); return; }

      // v0.3.4 — "c" recenters the canvas on the selected entity. No meta
      // modifier (so Cmd+C / Ctrl+C stay for copy), no input target. We
      // find the currently-selected table card by querying the DOM
      // (`.table-card.selected`) rather than closing over a state
      // variable — the keydown effect is installed early in render, well
      // before the `selected` state hook is declared, so referencing it
      // from here would hit JavaScript's temporal dead zone.
      if (!isInput && !meta && (e.key === "c" || e.key === "C")) {
        const card = document.querySelector(".table-card.selected");
        if (!card) return;
        e.preventDefault();
        // scrollIntoView's "center" option positions the card in the
        // middle of the nearest scrolling ancestor — that's `.canvas` in
        // our layout. Behaviour:smooth keeps the jump easy on the eye.
        try {
          card.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        } catch {
          card.scrollIntoView({ block: "center", inline: "center" });
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showShortcuts, cycleTheme, cycleProject, toggleBottomPanel, setCommandPaletteOpen, addToast]);

  /* ── Auto-switch bottom tab when entity selected ───────────────── */
  useEffect(() => {
    if (selectedEntityId) setBottomPanelTab("properties");
  }, [selectedEntityId, setBottomPanelTab]);

  /* ── Current git branch (displayed on project tabs bar) ───────── */
  const [branch, setBranch] = useState("main");
  useEffect(() => {
    if (!activeProjectId) { setBranch("main"); return; }
    let cancelled = false;
    fetchGitStatus(activeProjectId)
      .then((s) => { if (!cancelled && s?.branch) setBranch(s.branch); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeProjectId, activeModal /* refresh after branch dialog closes */]);

  /* ── Surface store errors as toasts ────────────────────────────── */
  useEffect(() => {
    if (error) { addToast({ type: "error", message: error }); clearError(); }
  }, [error, clearError, addToast]);

  /* ── Schema source: adapt active YAML; fall back to demo ─────────
     "Demo mode" = we have no real project on disk (the offline sample
     fixture). If the user has a registered project but the active file
     just doesn't parse as a DataLex model (e.g. a raw dbt schema.yml),
     show an empty diagram — NOT the Subscription Tracking demo — so the
     workspace chip / status bar / canvas all reflect reality.

     Diagram files (`.diagram.yaml`) compose entities from N referenced
     model files, so we route them through `adaptDiagramYaml` and pass
     the full projectFiles list as the lookup. */
  const isDiagramFile = React.useMemo(() => {
    const n = activeFile?.name || "";
    return /\.diagram\.ya?ml$/i.test(n);
  }, [activeFile]);

  /* Merge `fileContentCache` contents into the projectFiles list so both
     the diagram adapter and semantic-model type resolver can inspect
     already-loaded YAML without extra fetches. */
  const filesWithContent = React.useMemo(() => {
    const cache = fileContentCache || {};
    return (projectFiles || []).map((f) => {
      const key = normalizeWorkspaceFileRef(f?.fullPath || f?.path || "");
      if (typeof f?.content === "string") return f;
      if (key && typeof cache[key] === "string") return { ...f, content: cache[key] };
      return f;
    });
  }, [projectFiles, fileContentCache]);

  /* When viewing a diagram file, prefetch any referenced file contents so
     the adapter can render them. The store's `ensureFilesLoaded` skips
     already-cached paths, so this is a no-op on subsequent renders. */
  React.useEffect(() => {
    if (!activeFileContent) return;
    let paths = [];
    const semanticDependencyNames = new Set();
    try {
      if (isDiagramFile) {
        const doc = yaml.load(activeFileContent);
        if (doc && Array.isArray(doc.entities)) {
          paths = doc.entities
            .map((e) => normalizeWorkspaceFileRef(e?.file))
            .filter(Boolean);
        }
        filesWithContent
          .filter((file) => paths.includes(normalizeWorkspaceFileRef(file?.fullPath || file?.path || "")))
          .forEach((file) => {
            collectSemanticDependencyNames(file?.content).forEach((name) => semanticDependencyNames.add(name));
          });
      } else {
        collectSemanticDependencyNames(activeFileContent).forEach((name) => semanticDependencyNames.add(name));
      }
    } catch (_e) { /* malformed — nothing to prefetch */ }
    const semanticPaths = resolveSemanticDependencyPaths(projectFiles, [...semanticDependencyNames]);
    const allPaths = [...new Set([...paths, ...semanticPaths])];
    if (allPaths.length > 0) ensureFilesLoaded(allPaths);
  }, [isDiagramFile, activeFileContent, ensureFilesLoaded, filesWithContent, projectFiles]);

  // Key on modelGraphVersion as well so cross-file edits (e.g. saving a
  // neighbor model while a diagram is open) rebuild the adapted schema.
  // Without this, `filesForDiagram` content could go stale: the array
  // identity is the same but the underlying YAML on disk changed.
  const modelGraphVersion = useWorkspaceStore((s) => s.modelGraphVersion);
  const adapted = React.useMemo(() => {
    if (isDiagramFile) return adaptDiagramYaml(activeFileContent, filesWithContent);
    // Raw dbt schema.yml files (including semantic_models / metrics) should
    // render directly in the live shell, then fall back to DataLex shapes.
    return adaptDbtSchemaYaml(activeFileContent, filesWithContent) || adaptDataLexYaml(activeFileContent) || adaptDataLexModelYaml(activeFileContent);
  }, [activeFileContent, isDiagramFile, filesWithContent, modelGraphVersion]);
  const isDemo = useWorkspaceStore((s) => s.offlineMode && !s.activeProjectId);
  const emptySchema = React.useMemo(
    () => ({ name: "Project", engine: "DataLex", schema: "public", tables: [], relationships: [], subjectAreas: [] }),
    []
  );
  const schema = adapted || (isDemo ? DEMO_SCHEMA : emptySchema);

  /* Raw index list straight from the YAML, used by the inspector's
     IndexesView. Parsed lazily and cached per content change — js-yaml
     is already a dep so no extra cost. */
  const rawIndexes = React.useMemo(() => {
    if (!activeFileContent) return [];
    try {
      const doc = yaml.load(activeFileContent);
      return doc && Array.isArray(doc.indexes) ? doc.indexes : [];
    } catch (_e) { return []; }
  }, [activeFileContent]);
  const activeModelKind = String(schema?.modelKind || "physical").toLowerCase();
  const canRunForwardSql = activeModelKind === "physical";
  const openCurrentAiPanel = React.useCallback((source = "global") => {
    openAiPanel({
      source,
      targetName: selectedEntityId || activeFile?.name || "workspace",
      context: {
        kind: selectedEntityId ? "entity" : "workspace",
        entityName: selectedEntityId || null,
        filePath: activeFile?.path || activeFile?.fullPath || "",
        modelKind: activeModelKind,
      },
    });
  }, [activeFile, activeModelKind, openAiPanel, selectedEntityId]);

  React.useEffect(() => {
    const updateSelectionTarget = () => {
      const selection = window.getSelection?.();
      const text = selection?.toString?.().trim() || "";
      if (!selection || text.length < 3 || selection.rangeCount === 0) {
        setTextAiTarget(null);
        return;
      }
      const anchor = selection.anchorNode;
      const appRoot = document.querySelector(".luna-root") || document.body;
      const elementNode = window.Node?.ELEMENT_NODE || 1;
      if (anchor && appRoot && !appRoot.contains(anchor.nodeType === elementNode ? anchor : anchor.parentElement)) {
        setTextAiTarget(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        setTextAiTarget(null);
        return;
      }
      const x = Math.min(window.innerWidth - 124, Math.max(12, rect.left + rect.width / 2 - 52));
      const y = Math.max(12, rect.top - 42);
      setTextAiTarget({ text: text.slice(0, 4000), x, y });
    };
    const clearIfClickedAway = (event) => {
      if (event.target?.closest?.(".ai-selection-popover")) return;
      window.setTimeout(updateSelectionTarget, 0);
    };
    document.addEventListener("mouseup", clearIfClickedAway);
    document.addEventListener("keyup", updateSelectionTarget);
    document.addEventListener("selectionchange", updateSelectionTarget);
    return () => {
      document.removeEventListener("mouseup", clearIfClickedAway);
      document.removeEventListener("keyup", updateSelectionTarget);
      document.removeEventListener("selectionchange", updateSelectionTarget);
    };
  }, []);

  const openSelectedTextAiPanel = React.useCallback(() => {
    if (!textAiTarget?.text) return;
    openAiPanel({
      source: "selected-text",
      targetName: "selected text",
      context: {
        kind: "text_selection",
        selectedText: textAiTarget.text,
        entityName: selectedEntityId || null,
        filePath: activeFile?.path || activeFile?.fullPath || "",
        modelKind: activeModelKind,
      },
    });
    setTextAiTarget(null);
    window.getSelection?.()?.removeAllRanges?.();
  }, [activeFile, activeModelKind, openAiPanel, selectedEntityId, textAiTarget]);

  const panelModel = React.useMemo(() => schemaToPanelModel(schema), [schema]);

  /* ── Layout persistence (localStorage; keyed per project+file) ─── */
  const layoutKey = React.useMemo(() => {
    if (!activeProjectId || !activeFile) return null;
    const fp = activeFile.fullPath || activeFile.name || activeFile.id || "";
    return `datalex.layout.${activeProjectId}.${fp}`;
  }, [activeProjectId, activeFile]);

  const loadStoredLayout = React.useCallback(() => {
    if (!layoutKey) return {};
    try {
      const raw = localStorage.getItem(layoutKey);
      return raw ? JSON.parse(raw) : {};
    } catch (_e) { return {}; }
  }, [layoutKey]);

  /* ── Tables state (local copy so drag-move works + layout merge) ─ */
  const [tables, setTables] = React.useState(() => {
    const stored = layoutKey ? loadStoredLayout() : {};
    return schema.tables.map((t) => (stored[t.id] ? { ...t, ...stored[t.id] } : t));
  });
  React.useEffect(() => {
    const stored = loadStoredLayout();
    setTables(schema.tables.map((t) => (stored[t.id] ? { ...t, ...stored[t.id] } : t)));
  }, [schema, loadStoredLayout]);

  // Debounced write of positions back to localStorage whenever tables move.
  const saveLayoutTimer = React.useRef(null);
  React.useEffect(() => {
    if (!layoutKey) return;
    if (saveLayoutTimer.current) clearTimeout(saveLayoutTimer.current);
    saveLayoutTimer.current = setTimeout(() => {
      try {
        const map = {};
        tables.forEach((t) => { map[t.id] = { x: t.x, y: t.y }; });
        localStorage.setItem(layoutKey, JSON.stringify(map));
      } catch (_e) { /* quota or disabled storage — ignore */ }
    }, 300);
    return () => clearTimeout(saveLayoutTimer.current);
  }, [tables, layoutKey]);

  /* ── Diagram selection (luna panel) ────────────────────────────── */
  const [selected, setSelected] = React.useState(() =>
    schema.tables[0] ? { type: "table", id: schema.tables[0].id } : null
  );
  const [selectedCol, setSelectedCol] = React.useState(() =>
    schema.tables[0]?.columns[0]?.name || null
  );
  React.useEffect(() => {
    if (schema.tables[0]) {
      setSelected({ type: "table", id: schema.tables[0].id });
      setSelectedCol(schema.tables[0].columns[0]?.name || null);
    } else {
      setSelected(null);
      setSelectedCol(null);
    }
  }, [schema]);

  const activeTable = selected?.type === "table" ? tables.find((t) => t.id === selected.id) : null;
  const activeRel = selected?.type === "rel" ? schema.relationships.find((r) => r.id === selected.id) : null;

  React.useEffect(() => {
    setGraph({ nodes: [], edges: [], warnings: [], model: panelModel });
  }, [panelModel, setGraph]);

  React.useEffect(() => {
    if (selected?.type === "table" && activeTable) {
      selectDiagramEntity(activeTable.id);
      return;
    }
    clearDiagramSelection();
  }, [selected, activeTable, selectDiagramEntity, clearDiagramSelection]);

  const handleSelect = (sel) => {
    if (sel == null) { setSelected(null); return; }
    const ui = useUiStore.getState();
    const logicalMode = String(activeModelKind || "").toLowerCase() === "logical";
    if (typeof sel === "string") {
      setSelected({ type: "table", id: sel });
      const t = tables.find((x) => x.id === sel);
      if (t) setSelectedCol(t.columns[0]?.name);
      if (logicalMode) {
        ui.setRightPanelOpen(true);
        ui.setRightPanelTab("DETAILS");
      }
    } else {
      setSelected(sel);
      if (sel.type === "table") {
        const t = tables.find((x) => x.id === sel.id);
        if (t) setSelectedCol(t.columns[0]?.name);
        if (logicalMode) {
          ui.setRightPanelOpen(true);
          ui.setRightPanelTab("DETAILS");
        }
      } else if (sel.type === "rel" && logicalMode) {
        ui.setRightPanelOpen(true);
        ui.setRightPanelTab("RELATIONS");
      }
    }
  };

  /* ── Legend ────────────────────────────────────────────────────── */
  const [legendOpen, setLegendOpen] = React.useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = React.useState(() => {
    try {
      const raw = Number(window.localStorage.getItem(LEFT_PANEL_WIDTH_STORAGE));
      if (Number.isFinite(raw)) return Math.min(LEFT_PANEL_MAX, Math.max(LEFT_PANEL_MIN, raw));
    } catch (_err) {}
    return 280;
  });

  /* ── Project tabs: derive from workspace openProjects ─────────── */
  const projectTabs = React.useMemo(() => {
    if (!projects.length) return [];
    const orderedIds = openProjects.length ? openProjects : projects.map((p) => p.id);
    return orderedIds
      .map((id) => projects.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({
        id: p.id,
        name: p.name?.endsWith(".dlx") ? p.name : `${p.name}`,
        color: "var(--accent)",
        dirty: p.id === activeProjectId ? isDirty : false,
      }));
  }, [projects, openProjects, activeProjectId, isDirty]);

  const schemaList = React.useMemo(
    () => [{ name: schema.schema || "public", count: tables.length }],
    [schema.schema, tables.length]
  );

  const subjectAreaTreeItems = React.useMemo(
    () => (schema.subjectAreas || []).map((a) => ({ id: a.id, label: a.label, cat: a.cat })),
    [schema.subjectAreas]
  );

  /* v0.4.1 — top-bar domain switcher. Turns the adapted `subjectAreas`
     into the switcher's data model (name, count, color) and tallies
     how many tables have no `subject_area` at all so we can render the
     "Unassigned" section. Derived from `schema.tables` rather than
     the post-filter `tables` state so the switcher counts the full
     model, not whichever subset is currently shown. */
  const topBarDomains = React.useMemo(() => {
    const raw = Array.isArray(schema.subjectAreas) ? schema.subjectAreas : [];
    return raw
      .map((a) => ({
        name: a.name || a.label || a.id,
        count: Number.isFinite(a.count) ? a.count : 0,
        color: a.color,
      }))
      .filter((d) => !!d.name);
  }, [schema.subjectAreas]);

  const unassignedCount = React.useMemo(
    () => (schema.tables || []).reduce((n, t) => n + (t?.subject_area ? 0 : 1), 0),
    [schema.tables]
  );
  const hasUnassignedInModel = unassignedCount > 0 && topBarDomains.length > 0;

  /* Filter the post-layout `tables` down to the selected domain. The
     relationships array also gets filtered so dangling edges don't
     linger after the endpoints leave the canvas. When no filter is
     active we pass everything through unchanged — the filter work is
     cheap enough (O(n)) that memoising on the raw arrays is enough. */
  const activeSchemaFilter = useDiagramStore((s) => s.activeSchemaFilter);
  const UNASSIGNED_DOMAIN = "__unassigned_subject_area__";
  const filteredTables = React.useMemo(() => {
    if (!activeSchemaFilter) return tables;
    if (activeSchemaFilter === UNASSIGNED_DOMAIN) {
      return tables.filter((t) => !t?.subject_area);
    }
    return tables.filter((t) => t?.subject_area === activeSchemaFilter);
  }, [tables, activeSchemaFilter]);
  const filteredTableIds = React.useMemo(
    () => new Set(filteredTables.map((t) => t.id)),
    [filteredTables]
  );
  const filteredRelationships = React.useMemo(() => {
    const rels = schema.relationships || [];
    if (!activeSchemaFilter) return rels;
    return rels.filter((r) => filteredTableIds.has(r.from?.table) && filteredTableIds.has(r.to?.table));
  }, [schema.relationships, activeSchemaFilter, filteredTableIds]);

  /* ── Handlers wiring TopBar / tabs / tree into store ───────────── */
  const handleNewProject = () => openModal("addProject");
  const handleCloseProject = (pid) => {
    const ws = useWorkspaceStore.getState();
    if (ws.activeProjectId === pid && ws.isDirty) {
      const p = ws.projects.find((x) => x.id === pid);
      if (!window.confirm(`${p?.name || pid} has unsaved changes. Close without saving?`)) return;
    }
    closeProject(pid);
  };
  const handleNewTable = () => {
    if (activeFile) {
      openModal("newFile", {
        layerHint: activeModelKind,
        domainHint: schema?.domain || "",
      });
    }
    else addToast({ type: "error", message: "Open a project first." });
  };

  /* ── Entity add / delete (wired through yamlPatch helpers) ─────── */
  const handleAddEntity = React.useCallback((kind) => {
    const s = useWorkspaceStore.getState();
    if (!s.activeFile) { addToast({ type: "error", message: "Open a file first." }); return; }
    const activeIsDiagram = /\.diagram\.ya?ml$/i.test(s.activeFile?.name || "");
    if (activeIsDiagram) {
      if (kind === "ENUMS") {
        addToast({ type: "info", message: "Diagrams can only reference existing models. Open a model file to create an enum." });
        return;
      }
      openModal("entityPicker");
      return;
    }
    const isEnum = kind === "ENUMS";
    const label = isEnum ? "enum" : "entity";
    const name = window.prompt(`New ${label} name (e.g. ${isEnum ? "order_status" : "customer"})`);
    if (!name || !name.trim()) return;
    const clean = name.trim();
    const spec = isEnum
      ? { name: clean, type: "enum", values: [] }
      : { name: clean, type: "entity", fields: [{ name: "id", type: "uuid", primary_key: true }] };
    const next = appendEntity(s.activeFileContent, spec);
    if (next == null) {
      addToast({ type: "error", message: `Could not add ${label} — invalid YAML or duplicate name.` });
      return;
    }
    s.updateContent(next);
    s.flushAutosave?.().catch(() => {});
    addToast({ type: "success", message: `Added ${label} “${clean}”.` });
  }, [addToast, openModal]);

  const handleDeleteEntity = React.useCallback((entityName) => {
    if (!entityName) return;
    void (async () => {
      const s = useWorkspaceStore.getState();
      if (!s.activeFile) return;
      const activeIsDiagram = /\.diagram\.ya?ml$/i.test(s.activeFile?.name || "");
      const table = (schema.tables || []).find((t) =>
        t.id === entityName || String(t.name || "").toLowerCase() === String(entityName || "").toLowerCase()
      );
      const resolvedName = table?.name || entityName;
      const sourceFile = table?._sourceFile || "";
      const confirmCopy = activeIsDiagram
        ? `Remove entity “${resolvedName}” from this diagram?`
        : `Delete entity “${resolvedName}”? This removes its fields and every relationship, index, metric, and governance entry referencing it.`;
      if (!window.confirm(confirmCopy)) return;

      let referencedContent = sourceFile
        ? (s.fileContentCache?.[String(sourceFile).replace(/^[/\\]+/, "")] || "")
        : "";
      if (activeIsDiagram && sourceFile && !referencedContent) {
        try {
          await s.ensureFilesLoaded?.([sourceFile]);
          referencedContent =
            useWorkspaceStore.getState().fileContentCache?.[String(sourceFile).replace(/^[/\\]+/, "")] || "";
        } catch (_err) {
          // Best effort; deleteDiagramEntity will still fail cleanly if the
          // referenced YAML can't be loaded.
        }
      }

      const result = activeIsDiagram
        ? deleteDiagramEntity(s.activeFileContent, sourceFile, resolvedName, referencedContent)
        : deleteEntityDeep(s.activeFileContent, resolvedName);
      if (!result) {
        addToast({
          type: "error",
          message: activeIsDiagram
            ? `Could not remove “${resolvedName}” from the diagram — entry not found or YAML invalid.`
            : `Could not delete “${resolvedName}” — entity not found or YAML invalid.`,
        });
        return;
      }
      s.updateContent(result.yaml);
      s.flushAutosave?.().catch(() => {});
      setSelected(null);
      const extras = [];
      if (result.impact.relationships) extras.push(`${result.impact.relationships} relationship${result.impact.relationships === 1 ? "" : "s"}`);
      if (result.impact.indexes)       extras.push(`${result.impact.indexes} index${result.impact.indexes === 1 ? "" : "es"}`);
      if (result.impact.metrics)       extras.push(`${result.impact.metrics} metric${result.impact.metrics === 1 ? "" : "s"}`);
      if (result.impact.governance)    extras.push(`${result.impact.governance} governance entr${result.impact.governance === 1 ? "y" : "ies"}`);
      const suffix = extras.length ? ` (also removed ${extras.join(", ")})` : "";
      addToast({
        type: "success",
        message: activeIsDiagram
          ? `Removed “${resolvedName}” from the diagram${suffix}.`
          : `Deleted “${resolvedName}”${suffix}.`,
      });
      s.bumpModelGraphVersion?.();
    })();
  }, [addToast, schema.tables]);

  /* Delete relationship by its in-canvas id. Canvas relationships come from
   * schemaAdapter with ids like `r1`, `r2`, … for explicit entries and
   * `rfk-{table}-{col}` for inferred FK-column rels. We resolve id → name
   * against the active `relationships` list and delegate to the
   * yamlRoundTrip helper, which knows how to drop the `relationships[]`
   * entry and any matching `tests:` block. Inferred FK rels (`rfk-…`) have
   * no explicit YAML entry — for those we fall back to deleting the FK on
   * the column via deleteField. Keyboard-Delete uses this. */
  const handleDeleteRelationship = React.useCallback((relId) => {
    if (!relId) return;
    const rel = (schema.relationships || []).find((r) => r.id === relId);
    if (!rel) return;
    const s = useWorkspaceStore.getState();
    if (!s.activeFile) return;
    if (!window.confirm(`Delete relationship “${rel.name}”?`)) return;
    void (async () => {
      const origin = rel._origin || "";
      if (origin === "diagram_relationship") {
        const res = deleteRelationshipYaml(s.activeFileContent, rel.name);
        if (!res || res.error || !res.yaml) {
          addToast({ type: "error", message: `Could not delete relationship — ${res?.error || "not found in active YAML"}.` });
          return;
        }
        s.updateContent(res.yaml);
        s.flushAutosave?.().catch(() => {});
      } else if (origin === "model_relationship" && rel._sourceFile) {
        try {
          const result = await s.mutateReferencedFile(rel._sourceFile, (content) => {
            const next = deleteRelationshipYaml(content, rel.name);
            return next?.yaml || null;
          });
          if (!result?.changed) {
            addToast({ type: "error", message: "Could not delete relationship — not found in the source YAML." });
            return;
          }
        } catch (err) {
          addToast({ type: "error", message: err?.message || String(err) });
          return;
        }
      } else if (origin === "field_fk" && rel._sourceFile) {
        try {
          const result = await s.mutateReferencedFile(rel._sourceFile, (content) =>
            removeFieldRelationship(content, rel._fromEntityName, rel.from?.col, rel._toEntityName, rel.to?.col)
          );
          if (!result?.changed) {
            addToast({ type: "error", message: "Could not delete relationship — no matching FK/test found in the source YAML." });
            return;
          }
        } catch (err) {
          addToast({ type: "error", message: err?.message || String(err) });
          return;
        }
      } else {
        const res = deleteRelationshipYaml(s.activeFileContent, rel.name);
        if (!res || res.error || !res.yaml) {
          addToast({ type: "error", message: `Could not delete relationship — ${res?.error || "not found in active YAML"}.` });
          return;
        }
        s.updateContent(res.yaml);
        s.flushAutosave?.().catch(() => {});
      }
      setSelected(null);
      addToast({ type: "success", message: `Deleted relationship “${rel.name}”.` });
      s.bumpModelGraphVersion?.();
    })();
  }, [schema.relationships, addToast]);

  /* ── Smart ELK auto-layout (explicit user action) ─────────────────
   * Auto-layout should be a true readability reset. Diagram entities often
   * already have x/y because users dragged files onto the canvas, so treating
   * those coordinates as locked made the button look broken on messy diagrams.
   */
  const handleAutoLayout = React.useCallback(async () => {
    if (!tables.length) return;
    try {
      const mod = await import("../lib/elkLayout");
      const modelKind = String(activeModelKind || schema?.modelKind || "physical").toLowerCase();
      const conceptual = modelKind === "conceptual";
      const endpointKey = (value) => String(value || "").trim().toLowerCase();
      const tableIdByName = new Map();
      tables.forEach((t) => {
        [t.id, t.name, t.label, t.table].filter(Boolean).forEach((value) => {
          tableIdByName.set(endpointKey(value), t.id);
        });
      });
      const resolveEndpoint = (endpoint) => {
        const raw = endpoint?.table || endpoint?.entity || endpoint?.name || endpoint;
        return tableIdByName.get(endpointKey(raw)) || raw;
      };
      const estimateLayoutSize = (table) => {
        if (conceptual || table.type === "concept") {
          const description = String(table.description || "");
          const terms = Array.isArray(table.terms) ? table.terms : [];
          const tags = Array.isArray(table.tags) ? table.tags : [];
          let height = 160;
          if (description.length > 90) height += 24;
          if (description.length > 160) height += 18;
          if (terms.length || tags.length || table.owner || table.subject) height += 18;
          return { width: Math.max(Number(table.width) || 0, 300), height };
        }
        const columnCount = Array.isArray(table.columns) ? table.columns.length : 0;
        return {
          width: Math.max(Number(table.width) || 0, 300),
          height: Math.max(140, Math.min(760, 104 + columnCount * 24)),
        };
      };

      const rfNodes = tables.map((t) => ({
        id: t.id,
        type: "entityNode",
        position: { x: t.x || 0, y: t.y || 0 },
        ...estimateLayoutSize(t),
        data: {
          fields: t.columns,
          subject_area: t.subject || t.cat,
          modelKind,
          type: conceptual ? "concept" : t.type,
          description: t.description,
          owner: t.owner,
          terms: t.terms,
          tags: t.tags,
        },
      }));
      const nodeIds = new Set(rfNodes.map((node) => node.id));
      const rfEdges = (schema.relationships || []).map((r, i) => ({
        id: `e-${i}`,
        source: resolveEndpoint(r.from),
        target: resolveEndpoint(r.to),
      })).filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

      const { nodes: laid } = await mod.layoutWithElk(rfNodes, rfEdges, {
        density: conceptual ? "wide" : "normal",
        groupBySubjectArea: false,
        modelKind,
        direction: "RIGHT",
        fieldView: conceptual ? "minimal" : "all",
      });

      const xs = laid.map((n) => Number(n.position?.x)).filter(Number.isFinite);
      const ys = laid.map((n) => Number(n.position?.y)).filter(Number.isFinite);
      const minX = xs.length ? Math.min(...xs) : 0;
      const minY = ys.length ? Math.min(...ys) : 0;
      const originX = conceptual ? 110 : 80;
      const originY = conceptual ? 120 : 80;
      const pos = new Map(laid.map((n) => [
        n.id,
        {
          x: Math.round((Number(n.position?.x) || 0) - minX + originX),
          y: Math.round((Number(n.position?.y) || 0) - minY + originY),
        },
      ]));
      setTables((prev) => prev.map((t) => {
        const p = pos.get(t.id);
        return p ? { ...t, x: p.x, y: p.y, manualPosition: true } : t;
      }));
      addToast({ type: "success", message: conceptual ? "Smart conceptual layout applied." : "Auto-layout applied." });
    } catch (err) {
      addToast({ type: "error", message: `Auto-layout failed: ${err.message || err}` });
    }
  }, [activeModelKind, tables, schema?.modelKind, schema.relationships, addToast]);

  /* ── Persist moved node position to YAML `display:` ──────────────
   * Called by Canvas after a table drag completes. We round-trip through
   * `setEntityDisplay` → `updateContent`, which records the change in
   * history and flushes to the offline doc store. Cheap enough to run
   * synchronously on drag end; the mutate helper is ~microseconds on
   * jaffle-scale YAML. */
  const handleTableMoveEnd = React.useCallback((tableId) => {
    const t = tables.find((x) => x.id === tableId);
    if (!t) return;
    const s = useWorkspaceStore.getState();
    if (!s.activeFileContent) return;
    // When the active file is a diagram, positions live in the diagram
    // YAML's `entities[i].{x,y}` — keyed by (file, entity). Otherwise the
    // position belongs to the model file's `display:` block.
    const activeName = s.activeFile?.name || "";
    const activeIsDiagram = /\.diagram\.ya?ml$/i.test(activeName);
    let next;
    if (activeIsDiagram) {
      const sourceFile = t._sourceFile || "";
      next = sourceFile
        ? setDiagramEntityDisplay(s.activeFileContent, sourceFile, t.name || t._entityName || t.id, { x: t.x, y: t.y })
        : setInlineDiagramEntityDisplay(s.activeFileContent, t.name || t._entityName || t.id, { x: t.x, y: t.y });
    } else {
      next = setEntityDisplay(s.activeFileContent, t.name || t.id, { x: t.x, y: t.y });
    }
    if (next && next !== s.activeFileContent) {
      s.updateContent(next);
    }
  }, [tables]);

  const handleStartLeftResize = React.useCallback((event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftPanelWidth;
    const onMove = (moveEvent) => {
      const next = Math.min(
        LEFT_PANEL_MAX,
        Math.max(LEFT_PANEL_MIN, startWidth + (moveEvent.clientX - startX)),
      );
      setLeftPanelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [leftPanelWidth]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(LEFT_PANEL_WIDTH_STORAGE, String(leftPanelWidth));
    } catch (_err) {}
  }, [leftPanelWidth]);

  const handleGroupMoveEnd = React.useCallback((movedTables) => {
    const moved = Array.isArray(movedTables) ? movedTables.filter(Boolean) : [];
    if (moved.length === 0) return;
    const s = useWorkspaceStore.getState();
    if (!s.activeFileContent) return;
    const activeName = s.activeFile?.name || "";
    const activeIsDiagram = /\.diagram\.ya?ml$/i.test(activeName);
    let next = s.activeFileContent;
    moved.forEach((table) => {
      if (!next) return;
      if (activeIsDiagram) {
        const sourceFile = table._sourceFile || "";
        next = sourceFile
          ? setDiagramEntityDisplay(next, sourceFile, table.name || table._entityName || table.id, { x: table.x, y: table.y })
          : setInlineDiagramEntityDisplay(next, table.name || table._entityName || table.id, { x: table.x, y: table.y });
      } else {
        next = setEntityDisplay(next, table.name || table.id, { x: table.x, y: table.y });
      }
    });
    if (next && next !== s.activeFileContent) {
      s.updateContent(next);
      s.flushAutosave?.().catch(() => {});
    }
  }, []);

  /* ── Drag-to-connect: create the relationship directly when the active
     file can safely accept it, and only fall back to the dialog for
     ambiguous/manual cases. */
  const handleCanvasConnect = React.useCallback((payload) => {
    const s = useWorkspaceStore.getState();
    if (!s.activeFile || !s.activeFileContent) return;

    const fromTable = tables.find((table) => table.id === payload?.fromEntity || table.name === payload?.fromEntity);
    const toTable = tables.find((table) => table.id === payload?.toEntity || table.name === payload?.toEntity);
    const fromEntityName = String(fromTable?.name || payload?.fromEntity || "").trim();
    const toEntityName = String(toTable?.name || payload?.toEntity || "").trim();
    const fromColumn = String(payload?.fromColumn || "").trim();
    const toColumn = String(payload?.toColumn || "").trim();
    const normalizedKind = String(activeModelKind || "").toLowerCase();
    const entityLevelRelationship = normalizedKind === "conceptual" || normalizedKind === "logical";
    const dialogPayload = {
      ...payload,
      modelKind: activeModelKind,
      fromEntity: fromEntityName,
      toEntity: toEntityName,
      fromColumn,
      toColumn,
      tables: (tables || []).map((table) => ({
        id: table.name || table.id,
        name: table.name || table.id,
        columns: entityLevelRelationship ? [] : (table.columns || []),
      })),
    };

    if (!fromEntityName || !toEntityName) {
      openModal("newRelationship", dialogPayload);
      return;
    }

    if (isDiagramFile && entityLevelRelationship && (!fromColumn || !toColumn)) {
      const next = addDiagramRelationship(s.activeFileContent, {
        name: defaultRelationshipName(fromEntityName, toEntityName),
        from: { entity: fromEntityName },
        to: { entity: toEntityName },
        cardinality: normalizedKind === "conceptual" ? "many_to_many" : "many_to_one",
        verb: normalizedKind === "conceptual" ? "relates to" : undefined,
      });
      if (!next) {
        openModal("newRelationship", dialogPayload);
        return;
      }
      if (next === s.activeFileContent) {
        addToast({ type: "info", message: `Relationship ${fromEntityName} → ${toEntityName} already exists.` });
        return;
      }
      s.updateContent(next);
      s.flushAutosave?.().catch(() => {});
      s.bumpModelGraphVersion?.();
      addToast({ type: "success", message: `Linked ${fromEntityName} → ${toEntityName}.` });
      return;
    }

    if (!fromColumn || !toColumn) {
      openModal("newRelationship", dialogPayload);
      return;
    }

    const cardinality = inferRelationshipCardinality(
      fromTable?.columns?.find((column) => column.name === fromColumn),
      toTable?.columns?.find((column) => column.name === toColumn),
    );
    const name = defaultRelationshipName(fromEntityName, toEntityName);

    if (isDiagramFile) {
      const next = addDiagramRelationship(s.activeFileContent, {
        name,
        from: { entity: fromEntityName, field: fromColumn },
        to: { entity: toEntityName, field: toColumn },
        cardinality,
      });
      if (!next) {
        openModal("newRelationship", dialogPayload);
        return;
      }
      if (next === s.activeFileContent) {
        addToast({ type: "info", message: `Relationship ${fromEntityName}.${fromColumn} → ${toEntityName}.${toColumn} already exists.` });
        return;
      }
      s.updateContent(next);
      s.flushAutosave?.().catch(() => {});
      s.bumpModelGraphVersion?.();
      addToast({ type: "success", message: `Linked ${fromEntityName}.${fromColumn} → ${toEntityName}.${toColumn}.` });
      return;
    }

    const result = addRelationship(
      s.activeFileContent,
      name,
      `${fromEntityName}.${fromColumn}`,
      `${toEntityName}.${toColumn}`,
      cardinality,
    );
    if (result?.error || !result?.yaml || result.yaml === s.activeFileContent) {
      openModal("newRelationship", dialogPayload);
      return;
    }
    s.updateContent(result.yaml);
    s.flushAutosave?.().catch(() => {});
    s.bumpModelGraphVersion?.();
    addToast({ type: "success", message: `Linked ${fromEntityName}.${fromColumn} → ${toEntityName}.${toColumn}.` });
  }, [activeModelKind, addToast, isDiagramFile, openModal, tables]);

  /* ── Drop a YAML source onto the canvas: append its file reference
         to the active diagram's `entities:` and prefetch content. Only
         wired when the active file is a .diagram.yaml. */
  const handleCanvasDropYamlSource = React.useCallback(async ({ path, x, y }) => {
    if (!isDiagramFile) {
      addToast({
        type: "info",
        message: "Open a .diagram.yaml file first, then drop models onto the canvas.",
      });
      return;
    }
    try {
      await useWorkspaceStore.getState().addDiagramReferences([
        { file: path, entity: "*", x, y },
      ]);
    } catch (err) {
      addToast({ type: "error", message: `Could not add to diagram: ${err?.message || err}` });
    }
  }, [isDiagramFile, addToast]);

  const isEditable = !!(canEdit && canEdit());
  const activeBottomTabs = React.useMemo(
    () => {
      if (activeModelKind === "conceptual") return CONCEPTUAL_BOTTOM_TABS;
      if (activeModelKind === "logical") return LOGICAL_BOTTOM_TABS;
      if (activeModelKind === "physical") return PHYSICAL_BOTTOM_TABS;
      return isEditable ? PHYSICAL_BOTTOM_TABS : VIEWER_BOTTOM_TABS;
    },
    [activeModelKind, isEditable]
  );

  React.useEffect(() => {
    if (!activeBottomTabs.some((tab) => tab.id === bottomPanelTab)) {
      setBottomPanelTab(activeBottomTabs[0]?.id || "properties");
    }
  }, [activeBottomTabs, bottomPanelTab, setBottomPanelTab]);

  /* ── Shell render ──────────────────────────────────────────────── */
  return (
    <div
      className={`app ${bottomPanelOpen ? "with-bottom" : ""} ${rightPanelOpen ? "" : "no-right"} ${aiReviewDocument ? "with-ai-review" : ""}`}
      style={{ "--left-w": `${leftPanelWidth}px` }}
    >
      <TopBar
        onOpenCmd={() => setCommandPaletteOpen(true)}
        theme={theme}
        setTheme={setTheme}
        onNewTable={handleNewTable}
        onNewFile={() => (
          activeFile
            ? openModal("newFile", { layerHint: activeModelKind, domainHint: schema?.domain || "" })
            : openModal("addProject")
        )}
        onOpenFile={() => openModal("addProject")}
        onSave={async () => {
          if (!activeFile) return addToast({ type: "error", message: "No file to save." });
          await saveCurrentFile();
          const s = useWorkspaceStore.getState();
          if (s.lastAutoGeneratedDdl) addToast({ type: "success", message: `DDL: ${s.lastAutoGeneratedDdl}` });
          else if (s.lastAutoGenerateError) addToast({ type: "error", message: `DDL failed: ${s.lastAutoGenerateError}` });
          else addToast({ type: "success", message: "Saved." });
        }}
        onSaveAll={async () => {
          try {
            const result = await useWorkspaceStore.getState().saveAllDirty();
            if (!result || result.total === 0) {
              addToast({ type: "info", message: "Nothing to save." });
            } else if (result.ok) {
              addToast({ type: "success", message: `Saved ${result.saved} file(s).` });
            } else {
              addToast({ type: "warning", message: `Saved ${result.saved}/${result.total}; some files failed.` });
            }
          } catch (err) {
            addToast({ type: "error", message: `Save all failed: ${err?.message || err}` });
          }
        }}
        canSaveAll={!!activeProjectId && !useWorkspaceStore.getState().offlineMode}
        onUndo={() => {
          const ok = useWorkspaceStore.getState().undo();
          if (!ok) addToast({ type: "info", message: "Nothing to undo." });
        }}
        onRedo={() => {
          const ok = useWorkspaceStore.getState().redo();
          if (!ok) addToast({ type: "info", message: "Nothing to redo." });
        }}
        onSettings={() => openModal("settings")}
        onAiSettings={() => openModal("settings", { initialTab: "ai" })}
        onAskAi={() => openCurrentAiPanel("global")}
        onConnections={() => openModal("connectionsManager")}
        onCommit={() => openModal("commit")}
        onRunSql={() => canRunForwardSql && openModal("exportDdl")}
        onImport={() => openModal("importDialog")}
        onImportDbt={() => openModal("importDbtRepo")}
        onSearch={() => setCommandPaletteOpen(true)}
        canRunSql={canRunForwardSql}
        isDirty={isDirty}
        canSave={!!activeFile}
        domains={topBarDomains}
        hasUnassigned={hasUnassignedInModel}
        unassignedCount={unassignedCount}
      />

      <ProjectTabs
        projects={projectTabs}
        activeId={activeProjectId}
        onSelect={(id) => selectProject(id)}
        onClose={handleCloseProject}
        onNew={handleNewProject}
        branchName={branch}
        onBranchClick={() => activeProjectId && openModal("gitBranch")}
      />

      <LeftPanel
        activeTable={selected?.type === "table" ? selected.id : null}
        onSelectTable={(id) => handleSelect({ type: "table", id })}
        tables={tables}
        subjectAreas={subjectAreaTreeItems}
        schemas={schemaList}
        connectionLabel={
          isDemo
            ? "demo workspace"
            : (projects.find((p) => p.id === activeProjectId)?.name || activeProjectId || "workspace")
        }
        connectionDsn={
          isDemo
            ? "offline sample project"
            : (projects.find((p) => p.id === activeProjectId)?.path || `datalex://${activeProjectId || "local"}`)
        }
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={(id) => selectProject(id)}
        onAddEntity={handleAddEntity}
        onOpenConnectors={() => openModal("connectors")}
        onManageConnections={() => openModal("connectionsManager")}
      />
      <div
        className="left-resizer"
        onMouseDown={handleStartLeftResize}
        title="Drag to resize sidebar"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left sidebar"
      />

      {/* Main canvas cell swaps based on the top-bar ViewSwitcher.
          Only one surface mounts at a time; the others lazy-load on first
          click so the diagram path is not penalised. */}
      {shellViewMode === "diagram" && (
        <Canvas
          tables={filteredTables}
          setTables={setTables}
          relationships={filteredRelationships}
          areas={schema.subjectAreas || []}
          selected={selected}
          onSelect={handleSelect}
          onMoveEnd={handleTableMoveEnd}
          onMoveGroupEnd={handleGroupMoveEnd}
          onConnect={handleCanvasConnect}
          onDropYamlSource={handleCanvasDropYamlSource}
          onDeleteEntity={handleDeleteEntity}
          onDeleteRelationship={handleDeleteRelationship}
          onAutoLayout={handleAutoLayout}
          onExport={canRunForwardSql ? () => openModal("exportDdl") : undefined}
          title={schema.name}
          engine={schema.engine}
          modelKind={activeModelKind}
          legendOpen={legendOpen}
          setLegendOpen={setLegendOpen}
        />
      )}
      {shellViewMode === "table" && (
        <React.Suspense fallback={<div className="shell-view" style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 12 }}>Loading table view…</div>}>
          <TableView
            tables={filteredTables}
            relationships={filteredRelationships}
            activeTableId={selected?.type === "table" ? selected.id : null}
            onSelectTable={(id) => handleSelect({ type: "table", id })}
          />
        </React.Suspense>
      )}
      {shellViewMode === "views" && (
        <React.Suspense fallback={<div className="shell-view" style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 12 }}>Loading views…</div>}>
          <ViewsView
            onSelectTable={(id) => handleSelect({ type: "table", id })}
          />
        </React.Suspense>
      )}
      {shellViewMode === "enums" && (
        <React.Suspense fallback={<div className="shell-view" style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 12 }}>Loading enums…</div>}>
          <EnumsView />
        </React.Suspense>
      )}
      {shellViewMode === "docs" && (
        <React.Suspense fallback={<div className="shell-view" style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 12 }}>Rendering docs…</div>}>
          <DocsView />
        </React.Suspense>
      )}

      {aiReviewDocument && (
        <AiPlanReviewEditor
          document={aiReviewDocument}
          onClose={closeAiReviewDocument}
        />
      )}

      {rightPanelOpen && (
        <RightPanel
          table={activeTable}
          rel={activeRel}
          tables={tables}
          selectedCol={selectedCol}
          setSelectedCol={setSelectedCol}
          relationships={schema.relationships}
          indexes={rawIndexes}
          schema={schema}
          isDiagramFile={isDiagramFile}
          onSelectRel={handleSelect}
          onDeleteEntity={handleDeleteEntity}
          onExportDdl={canRunForwardSql ? () => openModal("exportDdl") : undefined}
        />
      )}

      {bottomPanelOpen && (
        <BottomDrawer tabs={activeBottomTabs}>
          <BottomPanelContent
            tab={bottomPanelTab}
            table={activeTable}
            rel={activeRel}
            relationships={schema.relationships}
            schema={schema}
            activeFile={activeFile}
            isDiagramFile={isDiagramFile}
          />
        </BottomDrawer>
      )}

      {!bottomPanelOpen && (
        <button className="bottom-reopen" onClick={toggleBottomPanel} title="Open panel (⌘J)">
          <ChevronUp size={12} /> Panel
        </button>
      )}

      {!(rightPanelOpen && rightPanelTab === "AI") && (
        <button
          type="button"
          className="ai-fab"
          onClick={() => openCurrentAiPanel("floating-assistant")}
          title="Ask AI about the current model, selection, or workspace"
        >
          <Wand2 size={16} />
          Ask AI
        </button>
      )}

      {textAiTarget && (
        <button
          type="button"
          className="ai-selection-popover"
          style={{ left: `${textAiTarget.x}px`, top: `${textAiTarget.y}px` }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={openSelectedTextAiPanel}
          title="Ask AI about selected text"
        >
          <Wand2 size={12} />
          Ask AI
        </button>
      )}

      <StatusBar
        density={density}
        setDensity={setDensity}
        tableCount={tables.length}
        relCount={schema.relationships.length}
        engine={schema.engine}
        saved={isDemo ? "Demo schema" : (isDirty ? "Unsaved" : `${openTabs.length} open`)}
        connectionState={isDemo ? "Demo mode" : "Connected"}
        bottomPanelOpen={bottomPanelOpen}
        onTogglePanel={toggleBottomPanel}
      />

      {/* Luna-style palette with real handlers for built-in actions. Extra
          actions (viewer welcome, git branch, …) are appended via
          extraCommands. The older LegacyCommandPalette remains available as
          a fallback if a user opts into it via a future setting. */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        tables={tables}
        onSelectTable={(id) => { handleSelect({ type: "table", id }); setCommandPaletteOpen(false); }}
        handlers={{
          newTable:        () => handleNewTable(),
          newRelationship: () => openModal("newRelationship", {
            // Give the dialog a picker over the current diagram's entities
            // so the user isn't forced to drag between column dots.
            tables: (tables || []).map((t) => ({
              id: t.id || t.name,
              name: t.name || t.id,
              columns: (t.columns || []).map((c) => ({ name: c.name })),
            })),
            modelKind: activeModelKind,
          }),
          autoLayout:      () => handleAutoLayout(),
          exportSql:       () => canRunForwardSql && openModal("exportDdl"),
          cycleTheme:      () => cycleTheme(),
        }}
        extraCommands={[
          { id: "welcome",    section: "Help",    label: "Show Viewer welcome",    meta: "",    icon: <span style={{ fontSize: 12 }}>👋</span>, run: () => openModal("welcome") },
          { id: "git-branch", section: "Git",     label: "Switch / create branch", meta: "",    icon: <span style={{ fontSize: 12 }}>⎇</span>,  run: () => activeProjectId && openModal("gitBranch") },
          { id: "commit",     section: "Git",     label: "Commit changes…",        meta: "",    icon: <span style={{ fontSize: 12 }}>✓</span>,  run: () => openModal("commit") },
          { id: "settings",   section: "Actions", label: "Settings…",              meta: "",    icon: <span style={{ fontSize: 12 }}>⚙</span>,  run: () => openModal("settings") },
          { id: "connect",    section: "Actions", label: "Manage connections…",    meta: "",    icon: <span style={{ fontSize: 12 }}>⛁</span>,  run: () => openModal("connectionsManager") },
          { id: "ask-ai",     section: "Actions", label: "Ask AI…",                 meta: "",    icon: <Wand2 size={12} />,                 run: () => openCurrentAiPanel("command-palette") },
          { id: "import",     section: "Actions", label: "Import schema…",         meta: "",    icon: <span style={{ fontSize: 12 }}>⇩</span>,  run: () => openModal("importDialog") },
          { id: "import-dbt", section: "Actions", label: "Import dbt repo…",       meta: "",    icon: <span style={{ fontSize: 12 }}>⤓</span>,  run: () => openModal("importDbtRepo") },
          ...(canRunForwardSql ? [
            { id: "apply-ddl",  section: "Actions", label: "Apply to warehouse…", meta: "", icon: <span style={{ fontSize: 12 }}>☁</span>, run: () => openModal("applyDdl") },
          ] : []),
          // v0.5.0 — stakeholder-share + snapshot flows. Share opens the
          // HTML bundle dialog prefilled from the currently-adapted schema;
          // snapshots routes through the new git-tag API.
          { id: "share-diagram", section: "Share", label: "Share diagram as HTML…", meta: "", icon: <span style={{ fontSize: 12 }}>⇪</span>, run: () => openModal("shareBundle", {
            title: schema?.name || activeFile?.name?.replace(/\.(diagram|model)\.ya?ml$/i, "") || "Diagram",
            projectName: (projects || []).find((p) => p.id === activeProjectId)?.name,
            tables: filteredTables,
            relationships: filteredRelationships,
            subjectAreas: schema?.subjectAreas || [],
          }) },
          { id: "snapshot-manage", section: "Share", label: "Snapshots (git tags)…", meta: "", icon: <span style={{ fontSize: 12 }}>⛒</span>, run: () => activeProjectId && openModal("snapshots") },
        ]}
      />

      {/* Modals (lazy-loaded where heavy) */}
      <React.Suspense fallback={null}>
        {activeModal === "addProject"         && <AddProjectModal />}
        {activeModal === "editProject"        && <EditProjectModal />}
        {activeModal === "newFile"            && <NewFileModal />}
        {activeModal === "settings"           && <SettingsDialog />}
        {activeModal === "connectionsManager" && <ConnectionsManager />}
        {activeModal === "commit"             && <CommitDialog />}
        {activeModal === "exportDdl"          && <ExportDdlDialog />}
        {activeModal === "applyDdl"           && <ApplyDdlDialog />}
        {activeModal === "importDialog"       && <PanelDialog kind="import" />}
        {activeModal === "connectors"         && <PanelDialog kind="connectors" />}
        {activeModal === "importDbtRepo"      && <ImportDbtRepoDialog />}
        {activeModal === "dbtYamlPicker"      && <DbtYamlPickerDialog />}
        {activeModal === "newConcept"         && <NewConceptDialog />}
        {activeModal === "newLogicalEntity"   && <NewLogicalEntityDialog />}
        {activeModal === "newRelationship"    && <NewRelationshipDialog />}
        {activeModal === "entityPicker"       && <EntityPickerDialog />}
        {activeModal === "bulkRenameColumn"   && <BulkRenameColumnDialog />}
        {activeModal === "shareBundle"        && <ShareBundleDialog />}
        {activeModal === "askAi"              && <AiAssistantDialog />}
        {activeModal === "snapshots"          && <SnapshotsDialog />}
        {activeModal === "gitBranch"          && <GitBranchDialog />}
        {activeModal === "welcome"            && <WelcomeModal onClose={closeModal} />}
        {showOnboarding                       && (
          <OnboardingJourney
            onClose={() => setShowOnboarding(false)}
            hasActiveProject={!!activeProjectId}
            modalOpen={Boolean(activeModal)}
            onImportProject={() => openModal("importDbtRepo")}
            onOpenValidation={() => setBottomPanelTab("validation")}
            onCreateEntity={() => openModal("newLogicalEntity")}
            onOpenAiSettings={() => openModal("settings", { initialTab: "ai" })}
            onAskAiToDraw={async () => {
              if (!activeProjectId) {
                throw new Error("Open a project first.");
              }
              const result = await aiConceptualize(activeProjectId);
              emitJourneyEvent("ai:conceptualize:applied", { result });
              return result;
            }}
          />
        )}
      </React.Suspense>

      {showShortcuts && <KeyboardShortcutsPanel onClose={() => setShowShortcuts(false)} />}

      <ToastContainer />
    </div>
  );
}
