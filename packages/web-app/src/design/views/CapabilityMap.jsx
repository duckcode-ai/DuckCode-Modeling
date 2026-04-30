/* CapabilityMap — top-tab view that renders the active project's
 * domains as a boxes-in-boxes capability hierarchy.
 *
 * The conceptual layer carries `domain` + `subject_area` per entity.
 * Both fields are flat metadata today; this view treats them as a
 * 2-level hierarchy:
 *
 *   Domain (top box) → Subject area (nested box) → Concept (chip)
 *
 * Each level shows a concept count. Click a concept chip to:
 *   - select it on the diagram store,
 *   - switch to Diagram view-mode,
 *   - open the Build panel so the user lands on the inline-editable
 *     Selected Concept block from Phase 1A.
 *
 * Replaces the LeanIX / Avolution use case for a YAML-first crowd:
 * "what business capabilities does this project model?". v1 keeps it
 * read-only — Phase 5 will add edit-in-place and capability authoring.
 *
 * Borrows the C4 leveling vocabulary (System / Container / Component)
 * for hierarchy depth, but uses business-domain terms in the UI so
 * non-technical stakeholders can read it.
 */
import React, { useMemo } from "react";
import { Boxes, Layers, AlertCircle, Search } from "lucide-react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import useUiStore from "../../stores/uiStore";
import useDiagramStore from "../../stores/diagramStore";
import { PanelFrame, PanelEmpty, StatusPill } from "../../components/panels/PanelFrame";

import { buildCapabilityHierarchy } from "./capabilityHierarchy";

function safeLoad(text) {
  try {
    const doc = yaml.load(text);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch (_err) {
    return null;
  }
}

function ConceptChip({ entity, onPick }) {
  const name = entity.name || entity.entity || "(unnamed)";
  const owner = entity.owner ? String(entity.owner) : "";
  const visibility = String(entity.visibility || "shared").toLowerCase();
  return (
    <button
      type="button"
      onClick={() => onPick(name)}
      title={[name, owner ? `owner: ${owner}` : null, `visibility: ${visibility}`].filter(Boolean).join(" · ")}
      style={{
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${visibility === "internal" ? "rgba(245,158,11,0.4)" : "var(--border-default)"}`,
        background: visibility === "internal"
          ? "rgba(245,158,11,0.08)"
          : visibility === "public"
            ? "rgba(34,197,94,0.10)"
            : "var(--bg-1)",
        color: "var(--text-primary)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.3,
        transition: "border-color 0.15s, transform 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent, #3b82f6)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = visibility === "internal" ? "rgba(245,158,11,0.4)" : "var(--border-default)"; e.currentTarget.style.transform = ""; }}
    >
      <span>{name}</span>
      {owner && (
        <span style={{ fontSize: 10.5, fontWeight: 500, color: "var(--text-tertiary)" }}>{owner}</span>
      )}
    </button>
  );
}

function SubjectAreaCard({ subjectArea, items, onPick }) {
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 10,
        background: "var(--bg-1)",
        border: "1px solid var(--border-default)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-0.005em", color: "var(--text-primary)" }}>
          {subjectArea}
        </div>
        <StatusPill tone="neutral">{items.length}</StatusPill>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
        {items.map((entity, idx) => (
          <ConceptChip key={(entity.name || entity.entity || idx) + ""} entity={entity} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function DomainCard({ domain, subjects, total, query, onPick }) {
  const filtered = query
    ? subjects
        .map((s) => ({
          ...s,
          items: s.items.filter((ent) => {
            const haystack = `${ent.name || ent.entity || ""} ${ent.description || ""} ${ent.owner || ""} ${ent.subject_area || ""} ${(ent.tags || []).join(" ")}`.toLowerCase();
            return haystack.includes(query);
          }),
        }))
        .filter((s) => s.items.length > 0)
    : subjects;
  if (query && filtered.length === 0) return null;
  const filteredTotal = filtered.reduce((acc, s) => acc + s.items.length, 0);
  return (
    <section
      id={`domain-${domain.replace(/\s+/g, "_")}`}
      style={{
        padding: 16,
        borderRadius: 14,
        background: "var(--bg-2)",
        border: "1px solid var(--border-default)",
        display: "grid",
        gap: 12,
      }}
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Boxes size={14} style={{ color: "var(--accent, #3b82f6)" }} />
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
            {domain}
          </h3>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusPill tone="info">{filteredTotal}{query && filteredTotal !== total ? ` / ${total}` : ""} concept{filteredTotal === 1 ? "" : "s"}</StatusPill>
          <StatusPill tone="neutral">{filtered.length} subject area{filtered.length === 1 ? "" : "s"}</StatusPill>
        </div>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
        {filtered.map((s) => (
          <SubjectAreaCard
            key={s.subjectArea}
            subjectArea={s.subjectArea}
            items={s.items}
            onPick={onPick}
          />
        ))}
      </div>
    </section>
  );
}

export default function CapabilityMap() {
  const activeFile = useWorkspaceStore((s) => s.activeFile);
  const activeFileContent = useWorkspaceStore((s) => s.activeFileContent);
  const setShellViewMode = useUiStore((s) => s.setShellViewMode);
  const setBottomPanelTab = useUiStore((s) => s.setBottomPanelTab);
  const selectEntity = useDiagramStore((s) => s.selectEntity);

  const [query, setQuery] = React.useState("");
  const trimmedQuery = query.trim().toLowerCase();

  const { hierarchy, totalConcepts, totalDomains, totalSubjectAreas } = useMemo(() => {
    const doc = safeLoad(activeFileContent || "");
    const entities = Array.isArray(doc?.entities) ? doc.entities : [];
    const hierarchy = buildCapabilityHierarchy(entities, doc);
    const totalConcepts = hierarchy.reduce((acc, d) => acc + d.total, 0);
    const totalSubjectAreas = hierarchy.reduce((acc, d) => acc + d.subjects.length, 0);
    return { hierarchy, totalConcepts, totalDomains: hierarchy.length, totalSubjectAreas };
  }, [activeFileContent]);

  const onPickConcept = (name) => {
    if (!name) return;
    selectEntity?.(name);
    setShellViewMode?.("diagram");
    setBottomPanelTab?.("modeler");
  };

  if (!activeFile) {
    return (
      <PanelFrame icon={<Boxes size={14} />} eyebrow="Capabilities" title="Capability Map">
        <PanelEmpty
          icon={Layers}
          title="No file open"
          description="Open a conceptual or logical YAML file in the Explorer. The Capability Map groups its concepts by domain and subject area so business stakeholders can see what the project actually covers."
        />
      </PanelFrame>
    );
  }

  if (totalConcepts === 0) {
    return (
      <PanelFrame icon={<Boxes size={14} />} eyebrow="Capabilities" title="Capability Map">
        <PanelEmpty
          icon={AlertCircle}
          title="No concepts in this file"
          description="The Capability Map renders entities grouped by domain. Add at least one entity (or open a different file) to populate it."
        />
      </PanelFrame>
    );
  }

  const filteredHierarchy = trimmedQuery
    ? hierarchy.filter((d) => {
        const inDomain = d.domain.toLowerCase().includes(trimmedQuery);
        const inSubject = d.subjects.some((s) => s.subjectArea.toLowerCase().includes(trimmedQuery));
        const inConcept = d.subjects.some((s) =>
          s.items.some((ent) => {
            const haystack = `${ent.name || ent.entity || ""} ${ent.description || ""} ${ent.owner || ""} ${(ent.tags || []).join(" ")}`.toLowerCase();
            return haystack.includes(trimmedQuery);
          })
        );
        return inDomain || inSubject || inConcept;
      })
    : hierarchy;

  const filteredConcepts = filteredHierarchy.reduce((acc, d) => {
    return acc + d.subjects.reduce((subAcc, s) => {
      if (!trimmedQuery) return subAcc + s.items.length;
      return subAcc + s.items.filter((ent) => {
        const haystack = `${ent.name || ent.entity || ""} ${ent.description || ""} ${ent.owner || ""} ${(ent.tags || []).join(" ")}`.toLowerCase();
        return haystack.includes(trimmedQuery);
      }).length;
    }, 0);
  }, 0);

  return (
    <div
      className="shell-view"
      style={{
        height: "100%",
        overflowY: "auto",
        padding: "20px 24px 32px",
        color: "var(--text-primary)",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "grid", gap: 18 }}>
        <header style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em", color: "var(--text-primary)" }}>
              Capability Map
            </h1>
            <StatusPill tone="info">{totalDomains} domain{totalDomains === 1 ? "" : "s"}</StatusPill>
            <StatusPill tone="neutral">{totalSubjectAreas} subject area{totalSubjectAreas === 1 ? "" : "s"}</StatusPill>
            <StatusPill tone="success">{totalConcepts} concept{totalConcepts === 1 ? "" : "s"}</StatusPill>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>
            Concepts grouped by <code>domain</code> then <code>subject_area</code>. Click a concept to drill into the diagram with its Build panel open.
          </p>
          <div style={{ position: "relative", maxWidth: 420 }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", pointerEvents: "none" }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter concepts, owners, tags…"
              className="panel-input"
              style={{ width: "100%", padding: "7px 10px 7px 30px", fontSize: 13 }}
            />
          </div>
        </header>

        {trimmedQuery && filteredConcepts === 0 && (
          <PanelEmpty
            icon={Search}
            title={`No matches for "${query}"`}
            description="Try a domain name, subject area, owner, or tag."
          />
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {filteredHierarchy.map((d) => (
            <DomainCard
              key={d.domain}
              domain={d.domain}
              subjects={d.subjects}
              total={d.total}
              query={trimmedQuery}
              onPick={onPickConcept}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
