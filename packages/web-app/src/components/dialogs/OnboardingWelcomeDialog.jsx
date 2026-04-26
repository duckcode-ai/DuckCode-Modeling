/* OnboardingWelcomeDialog — first-visit modal offering Continue / Skip.
 *
 * Shown once per browser. It introduces the current DataLex workflow:
 * create modeling assets by layer, model conceptually/logically/physically,
 * validate, and save to Git-friendly YAML.
 */
import React from "react";
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Database,
  FileCode2,
  FolderTree,
  GitBranch,
  KeyRound,
  Layers3,
  Network,
  Route,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  startOnboardingTour,
  markTourSeen,
} from "../../lib/onboardingTour";

const VALUE_POINTS = [
  {
    icon: Network,
    tone: "#22c55e",
    title: "Make meaning explicit",
    text: "Connect business concepts, logical rules, and dbt implementation so analytics work has traceable context.",
  },
  {
    icon: ShieldCheck,
    tone: "#f59e0b",
    title: "Catch gaps early",
    text: "Review descriptions, ownership, grain, keys, tests, contracts, sensitivity, and import health before models spread.",
  },
  {
    icon: Bot,
    tone: "#818cf8",
    title: "Prepare for AI analytics",
    text: "Give agents and semantic models governed metadata so generated answers are grounded, explainable, and safer to reuse.",
  },
];

const WORKFLOW_STEPS = [
  {
    icon: Layers3,
    tone: "#22c55e",
    title: "Start with intent",
    kicker: "Conceptual model",
    text: "Define business concepts, domains, owners, glossary terms, and relationship verbs in stakeholder language.",
  },
  {
    icon: KeyRound,
    tone: "#06b6d4",
    title: "Shape the rules",
    kicker: "Logical model",
    text: "Capture attributes, candidate keys, optionality, role names, cardinality, lineage, and reusable entity structure.",
  },
  {
    icon: Database,
    tone: "#818cf8",
    title: "Ground it in dbt",
    kicker: "Physical model",
    text: "Import dbt, review YAML readiness, fix metadata/tests/contracts, and keep changes as reviewable Git diffs.",
  },
];

const FEATURE_ITEMS = [
  { icon: FolderTree, text: "Import a dbt repo and keep the same files visible instead of creating a separate review workspace." },
  { icon: CheckCircle2, text: "See red/yellow/green readiness on YAML files, then open the file to understand the gap." },
  { icon: Sparkles, text: "Use DataLex AI to explain findings and create reviewable YAML proposals, not silent auto-edits." },
  { icon: Route, text: "Move from physical dbt metadata into conceptual, logical, semantic, and governance models." },
  { icon: FileCode2, text: "Generate or refine dbt SQL/YAML from approved modeling decisions when the model is ready." },
  { icon: GitBranch, text: "Save everything as local YAML so teams review changes through normal Git workflows." },
];

function IconBadge({ icon: Icon, color }) {
  return (
    <span
      style={{
        width: 34,
        height: 34,
        borderRadius: 10,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, var(--border-default))`,
        flexShrink: 0,
      }}
    >
      <Icon size={17} />
    </span>
  );
}

export default function OnboardingWelcomeDialog({ onClose }) {
  const handleContinue = () => {
    onClose?.();
    setTimeout(() => startOnboardingTour(), 60);
  };

  const handleSkip = () => {
    markTourSeen();
    onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.58)",
        backdropFilter: "blur(5px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
      onClick={handleSkip}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(820px, 94vw)",
          maxHeight: "min(760px, 92vh)",
          overflow: "auto",
          background: "var(--bg-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          boxShadow: "var(--shadow-pop)",
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={handleSkip}
          title="Skip onboarding"
          aria-label="Skip onboarding"
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            background: "transparent",
            border: "none",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            padding: 7,
            borderRadius: 7,
          }}
        >
          <X size={16} />
        </button>

        <div style={{ padding: "30px 32px 18px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 10px",
              borderRadius: 999,
              background: "rgba(59,130,246,0.12)",
              color: "#60a5fa",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            <Sparkles size={12} /> Modeling Workbench
          </div>

          <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
            <h2
              id="onboarding-title"
              style={{
                fontSize: 24,
                lineHeight: 1.22,
                fontWeight: 700,
                margin: 0,
                color: "var(--text-primary)",
                letterSpacing: 0,
              }}
            >
              DataLex turns dbt projects into governed, AI-ready data models.
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 13.5,
                lineHeight: 1.65,
                color: "var(--text-secondary)",
              }}
            >
              Modern analytics teams move fast in SQL and dbt, but the business meaning, modeling rules,
              ownership, tests, and semantic context often stay scattered. That makes reuse harder and makes
              AI agents less reliable. DataLex adds a lightweight modeling and review layer around your existing
              YAML so teams can detect gaps early, fix them with context, and build better semantic foundations.
            </p>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 10,
            padding: "6px 32px 18px",
          }}
        >
          {VALUE_POINTS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                style={{
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-1)",
                  borderRadius: 10,
                  padding: 13,
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <IconBadge icon={Icon} color={item.tone} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                    {item.text}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 10,
            padding: "0 32px 18px",
          }}
        >
          {WORKFLOW_STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                style={{
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-1)",
                  borderRadius: 10,
                  padding: 13,
                  minHeight: 158,
                  display: "grid",
                  gap: 9,
                  alignContent: "start",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <IconBadge icon={Icon} color={step.tone} />
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      Step {index + 1}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                      {step.title}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: step.tone }}>
                  {step.kicker}
                </div>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: "var(--text-secondary)" }}>
                  {step.text}
                </p>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "0 32px 24px" }}>
          <div
            style={{
              border: "1px solid var(--border-default)",
              borderRadius: 10,
              background: "color-mix(in srgb, var(--bg-1) 82%, transparent)",
              padding: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <BookOpen size={15} style={{ color: "var(--accent, #3b82f6)" }} />
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                What the guided tour shows
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "9px 14px",
              }}
            >
              {FEATURE_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.text} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <Icon size={14} style={{ color: "var(--text-tertiary)", marginTop: 2, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                      {item.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "16px 22px",
            borderTop: "1px solid var(--border-default)",
            background: "var(--bg-1)",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={handleSkip}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border-default)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Skip for now
          </button>
          <button
            type="button"
            onClick={handleContinue}
            autoFocus
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--accent, #3b82f6)",
              background: "var(--accent, #3b82f6)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Start guided tour
          </button>
        </div>
      </div>
    </div>
  );
}
