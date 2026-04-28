/* UnitTestsPanel — read-only viewer for dbt 1.8+ unit tests in the active
   YAML. Surfaces the model under test, given/expect counts, and any
   missing description so unit-test hygiene is visible at a glance. */
import React, { useMemo } from "react";
import { FlaskConical, AlertTriangle } from "lucide-react";
import yaml from "js-yaml";
import useWorkspaceStore from "../../stores/workspaceStore";
import { PanelFrame, PanelSection, PanelEmpty, PanelCard, StatusPill, KeyValueGrid } from "./PanelFrame";

function safeLoad(text) {
  try {
    const doc = yaml.load(text);
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch (_) {
    return null;
  }
}

function collectUnitTests(doc) {
  if (!doc) return [];
  if (Array.isArray(doc.unit_tests)) return doc.unit_tests;
  if (doc.kind === "unit_test") return [doc];
  return [];
}

export default function UnitTestsPanel() {
  const { activeFileContent } = useWorkspaceStore();
  const tests = useMemo(() => collectUnitTests(safeLoad(activeFileContent || "")), [activeFileContent]);

  if (!tests.length) {
    return (
      <PanelFrame icon={<FlaskConical size={14} />} eyebrow="dbt resources" title="Unit Tests">
        <PanelEmpty
          icon={FlaskConical}
          title="No unit tests"
          description="The active YAML has no unit_tests: section. dbt 1.8+ supports unit tests directly in YAML — declare given/expect blocks per model to validate transformation logic."
        />
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      icon={<FlaskConical size={14} />}
      eyebrow="dbt resources"
      title="Unit Tests"
      subtitle={`${tests.length} unit test${tests.length === 1 ? "" : "s"}`}
    >
      <PanelSection title="Test fixtures" count={tests.length}>
        {tests.map((test, idx) => {
          const given = Array.isArray(test.given) ? test.given : [];
          const expect = test.expect || {};
          const expectRows = Array.isArray(expect.rows) ? expect.rows.length : 0;
          const noDescription = !test.description;
          return (
            <PanelCard
              key={test.name || idx}
              title={test.name || `unit_test_${idx}`}
              subtitle={test.description || (noDescription ? "(no description)" : "")}
              tone={noDescription ? "warning" : "neutral"}
              icon={noDescription ? <AlertTriangle size={11} /> : null}
              actions={<StatusPill tone="info">{`model ${test.model || "?"}`}</StatusPill>}
            >
              <KeyValueGrid
                items={[
                  { label: "model", value: test.model || "—" },
                  { label: "given inputs", value: given.length },
                  { label: "expected rows", value: expectRows },
                  { label: "overrides", value: test.overrides ? "yes" : "—" },
                ]}
              />
            </PanelCard>
          );
        })}
      </PanelSection>
    </PanelFrame>
  );
}
