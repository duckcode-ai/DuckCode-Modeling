/* OnboardingWelcomeDialog — first-visit modal offering Continue / Skip.
 *
 * Shown once (per browser) when the Shell mounts and
 * `shouldShowFirstRun()` returns true. Either choice marks the tour as
 * seen so we don't nag the user on every reload; "Replay onboarding
 * tour" in Settings spawns the tour again explicitly.
 *
 * Kept visually simple (no dependency on the Modal primitive) because
 * it fires before the user has seen anything else in the app — it's
 * the first surface they meet. */
import React from "react";
import { Sparkles, X } from "lucide-react";
import {
  startOnboardingTour,
  markTourSeen,
} from "../../lib/onboardingTour";

export default function OnboardingWelcomeDialog({ onClose }) {
  const handleContinue = () => {
    onClose?.();
    // Tour starts after the modal unmounts so the spotlight can
    // actually reach the underlying toolbar buttons.
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
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={handleSkip}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 92vw)",
          background: "var(--bg-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow: "var(--shadow-pop)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={handleSkip}
          title="Skip onboarding"
          aria-label="Skip onboarding"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "transparent",
            border: "none",
            color: "var(--text-tertiary)",
            cursor: "pointer",
            padding: 6,
            borderRadius: 6,
          }}
        >
          <X size={16} />
        </button>

        <div style={{ padding: "28px 28px 18px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(59,130,246,0.12)",
              color: "#3b82f6",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            <Sparkles size={12} /> Welcome
          </div>
          <h2
            id="onboarding-title"
            style={{
              fontSize: 22,
              fontWeight: 600,
              margin: 0,
              color: "var(--text-primary)",
            }}
          >
            Take a 60-second tour of DataLex?
          </h2>
          <p
            style={{
              marginTop: 12,
              marginBottom: 0,
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--text-secondary)",
            }}
          >
            We'll highlight the icons and panels that matter — importing
            your dbt project, building diagrams, wiring relationships,
            validating, and saving. You can replay the tour anytime
            from Settings.
          </p>
        </div>

        <ul
          style={{
            margin: 0,
            padding: "4px 28px 18px",
            listStyle: "none",
            display: "grid",
            gap: 6,
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          {[
            "Import your dbt repo (folder / git URL / jaffle-shop demo)",
            "Build your first diagram with auto-layout",
            "Wire relationships with inline endpoint validation",
            "Save All — merge-safe, git-diff-ready",
          ].map((t) => (
            <li
              key={t}
              style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 999,
                  background: "var(--accent, #3b82f6)",
                  marginTop: 7,
                  flexShrink: 0,
                }}
              />
              <span>{t}</span>
            </li>
          ))}
        </ul>

        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "16px 20px",
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
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Start tour →
          </button>
        </div>
      </div>
    </div>
  );
}
