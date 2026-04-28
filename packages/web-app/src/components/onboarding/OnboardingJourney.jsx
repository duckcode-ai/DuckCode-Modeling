/* OnboardingJourney — first-run guided journey panel.
 *
 * Renders as a 480px right-rail panel anchored to the viewport so the
 * shell behind it stays usable. Walks the user through six concrete
 * actions (welcome → connect → see gaps → design → AI key → ask AI).
 * Each step has a primary CTA that opens the relevant dialog or tab
 * and auto-marks itself complete when the corresponding event fires.
 *
 * Persistence is handled by ../lib/onboardingJourney.js — this
 * component is a pure view + event subscriber. */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, X, Minus } from "lucide-react";
import JourneyStepCard from "./JourneyStepCard";
import {
  JOURNEY_STEPS,
  getJourneyState,
  markStepComplete,
  dismissJourney,
  subscribeJourneyEvents,
} from "../../lib/onboardingJourney";

const PANEL_WIDTH = 480;

function readAiKey() {
  try {
    return localStorage.getItem("datalex.ai.apiKey") || "";
  } catch {
    return "";
  }
}

export default function OnboardingJourney({
  onClose,
  onImportProject,
  onOpenValidation,
  onCreateEntity,
  onOpenAiSettings,
  onAskAiToDraw,
  hasActiveProject = false,
}) {
  const [state, setState] = useState(() => getJourneyState());
  const [collapsed, setCollapsed] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState("");

  // Re-read persisted state whenever an event fires that may have
  // marked a step complete (the dialog handlers call markStepComplete
  // synchronously then emit the event).
  const refresh = useCallback(() => {
    setState(getJourneyState());
  }, []);

  useEffect(() => {
    const off = subscribeJourneyEvents(({ name }) => {
      const target = JOURNEY_STEPS.find((s) => s.completeOn === name);
      if (target) {
        markStepComplete(target.id);
        refresh();
      }
    });
    return off;
  }, [refresh]);

  // Reload when the panel becomes visible after being collapsed —
  // some events may have fired while the user was using the app.
  useEffect(() => {
    if (!collapsed) refresh();
  }, [collapsed, refresh]);

  const aiConfigured = useMemo(() => Boolean(readAiKey()), [state.completed]);

  // If the user already has an AI key configured (e.g. they used
  // DataLex before this version), mark the AI step complete on mount
  // so the journey doesn't ask them to "do it again".
  useEffect(() => {
    if (aiConfigured && !state.completed.includes("ai")) {
      markStepComplete("ai");
      refresh();
    }
  }, [aiConfigured, state.completed, refresh]);

  const handlePrimary = useCallback(
    async (stepId) => {
      switch (stepId) {
        case "welcome":
          markStepComplete("welcome");
          refresh();
          return;
        case "connect":
          onImportProject?.();
          return;
        case "gaps":
          onOpenValidation?.();
          // The validation tab opens immediately; mark complete optimistically.
          markStepComplete("gaps");
          refresh();
          return;
        case "design":
          onCreateEntity?.();
          return;
        case "ai":
          onOpenAiSettings?.();
          return;
        case "draw":
          if (!onAskAiToDraw) return;
          setDrawing(true);
          setDrawError("");
          try {
            await onAskAiToDraw();
            markStepComplete("draw");
            refresh();
          } catch (err) {
            setDrawError(err?.message || String(err) || "Could not start the conceptualizer.");
          } finally {
            setDrawing(false);
          }
          return;
        default:
          return;
      }
    },
    [onAskAiToDraw, onCreateEntity, onImportProject, onOpenAiSettings, onOpenValidation, refresh]
  );

  const handleSkipStep = useCallback(
    (stepId) => {
      markStepComplete(stepId);
      refresh();
    },
    [refresh]
  );

  const handleDismiss = useCallback(() => {
    dismissJourney();
    onClose?.();
  }, [onClose]);

  const handleFinish = useCallback(() => {
    dismissJourney({ markDone: true });
    onClose?.();
  }, [onClose]);

  const completedCount = state.completed.length;
  const totalSteps = JOURNEY_STEPS.length;
  const progressPct = Math.round((completedCount / totalSteps) * 100);
  const allDone = completedCount >= totalSteps;

  // Collapsed mini-pill in the bottom-right.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title="Resume onboarding"
        aria-label="Resume onboarding"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 180,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          background: "var(--accent, #3b82f6)",
          color: "#fff",
          border: "none",
          borderRadius: 999,
          boxShadow: "var(--shadow-pop)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <Sparkles size={14} />
        Onboarding · {completedCount}/{totalSteps}
      </button>
    );
  }

  return (
    <aside
      role="complementary"
      aria-label="DataLex onboarding"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: `min(${PANEL_WIDTH}px, 96vw)`,
        background: "var(--bg-1)",
        borderLeft: "1px solid var(--border-strong)",
        boxShadow: "var(--shadow-pop)",
        zIndex: 160,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          padding: "20px 22px 16px",
          borderBottom: "1px solid var(--border-default)",
          background: "var(--bg-2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 11px",
              borderRadius: 999,
              background: "rgba(59,130,246,0.14)",
              color: "#60a5fa",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            <Sparkles size={12} /> Get started
          </span>

          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title="Hide for now (resume from the floating button)"
              aria-label="Collapse onboarding"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                padding: 6,
                borderRadius: 6,
              }}
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              title="Dismiss onboarding (replay anytime from Settings)"
              aria-label="Dismiss onboarding"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                padding: 6,
                borderRadius: 6,
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <h2
          id="onboarding-journey-title"
          style={{
            margin: 0,
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "var(--text-primary)",
            lineHeight: 1.2,
          }}
        >
          Build your first DataLex model
        </h2>
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
          }}
        >
          Six short steps from an empty workspace to an AI-drawn diagram you can review.
        </p>

        <div style={{ marginTop: 14 }}>
          <div
            style={{
              height: 6,
              background: "var(--bg-3, rgba(255,255,255,0.06))",
              borderRadius: 999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progressPct}%`,
                background: "var(--accent, #3b82f6)",
                transition: "width 0.3s",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 6,
              fontSize: 12,
              color: "var(--text-tertiary)",
            }}
          >
            <span>
              Step {Math.min(completedCount + 1, totalSteps)} of {totalSteps}
            </span>
            <span>{progressPct}%</span>
          </div>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {JOURNEY_STEPS.map((step, idx) => {
          const done = state.completed.includes(step.id);
          const active = !done && idx === state.currentIndex;
          const cardState = done ? "done" : active ? "active" : "upcoming";

          let primaryDisabled = false;
          let primaryHint = "";
          if (step.id === "draw") {
            if (drawing) {
              primaryDisabled = true;
              primaryHint = "Asking the conceptualizer to read your staging models…";
            } else if (!hasActiveProject) {
              primaryDisabled = true;
              primaryHint = "Open a project first (step 2).";
            } else if (!aiConfigured) {
              primaryDisabled = true;
              primaryHint = "Add an AI provider first (step 5).";
            } else if (drawError) {
              primaryHint = drawError;
            }
          }
          if (step.id === "gaps" && !hasActiveProject) {
            primaryDisabled = true;
            primaryHint = "Import a project first (step 2).";
          }
          if (step.id === "design" && !hasActiveProject) {
            primaryDisabled = true;
            primaryHint = "Import or open a project first.";
          }

          return (
            <JourneyStepCard
              key={step.id}
              index={idx}
              step={step}
              state={cardState}
              onPrimary={() => handlePrimary(step.id)}
              onSkip={active && step.id !== "welcome" ? () => handleSkipStep(step.id) : null}
              primaryDisabled={primaryDisabled}
              primaryHint={primaryHint}
            />
          );
        })}

        {allDone && (
          <div
            style={{
              padding: 18,
              borderRadius: 12,
              background: "rgba(34,197,94,0.10)",
              border: "1px solid rgba(34,197,94,0.35)",
              color: "var(--text-primary)",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
              You're set up.
            </div>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
              Replay this journey or run the deep feature tour anytime from Settings → Onboarding.
            </p>
          </div>
        )}
      </div>

      <footer
        style={{
          padding: "12px 22px 16px",
          borderTop: "1px solid var(--border-default)",
          display: "flex",
          gap: 10,
          justifyContent: "flex-end",
          background: "var(--bg-2)",
        }}
      >
        {!allDone ? (
          <button
            type="button"
            onClick={handleDismiss}
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
            Skip all
          </button>
        ) : (
          <button
            type="button"
            onClick={handleFinish}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: `1px solid var(--accent, #3b82f6)`,
              background: "var(--accent, #3b82f6)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Finish
          </button>
        )}
      </footer>
    </aside>
  );
}
