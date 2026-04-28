/* JourneyStepCard — one card in the onboarding journey panel.
 *
 * Three visual states:
 *   - active   : current step, expanded with body + CTA + skip
 *   - done     : completed, collapsed with a green check
 *   - upcoming : not yet reached, collapsed and dimmed
 *
 * Typography is intentionally larger than the rest of the app's chrome
 * (22px title, 15px body) — the user's main feedback was that the old
 * welcome modal was too small to read. */
import React from "react";
import { Check, ArrowRight } from "lucide-react";

const ACCENT = "var(--accent, #3b82f6)";
const DONE = "#22c55e";

export default function JourneyStepCard({
  index,
  step,
  state, // 'active' | 'done' | 'upcoming'
  onPrimary,
  onSkip,
  primaryDisabled = false,
  primaryHint = "",
}) {
  const isActive = state === "active";
  const isDone = state === "done";
  const number = index + 1;

  return (
    <div
      style={{
        background: isActive ? "var(--bg-2)" : "var(--bg-1)",
        border: `1px solid ${isActive ? "var(--border-strong)" : "var(--border-default)"}`,
        borderRadius: 12,
        padding: isActive ? 24 : 14,
        boxShadow: isActive ? "var(--shadow-pop)" : "none",
        opacity: state === "upcoming" ? 0.55 : 1,
        transition: "opacity 0.2s, padding 0.2s, background 0.2s",
      }}
      aria-current={isActive ? "step" : undefined}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: isActive ? 14 : 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: isDone ? DONE : isActive ? ACCENT : "var(--bg-3, rgba(255,255,255,0.05))",
            color: isDone || isActive ? "#fff" : "var(--text-tertiary)",
            fontSize: 15,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {isDone ? <Check size={16} strokeWidth={3} /> : number}
        </span>
        <h3
          style={{
            margin: 0,
            fontSize: isActive ? 22 : 15,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: isDone
              ? "var(--text-secondary)"
              : isActive
              ? "var(--text-primary)"
              : "var(--text-tertiary)",
            textDecoration: isDone ? "line-through" : "none",
            lineHeight: 1.25,
          }}
        >
          {step.title}
        </h3>
      </div>

      {isActive && (
        <>
          <p
            style={{
              margin: "0 0 18px 0",
              fontSize: 15,
              lineHeight: 1.7,
              color: "var(--text-secondary)",
            }}
          >
            {step.body}
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onPrimary}
              disabled={primaryDisabled}
              autoFocus
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 18px",
                borderRadius: 10,
                border: `1px solid ${primaryDisabled ? "var(--border-default)" : ACCENT}`,
                background: primaryDisabled ? "var(--bg-3, rgba(255,255,255,0.05))" : ACCENT,
                color: primaryDisabled ? "var(--text-tertiary)" : "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: primaryDisabled ? "not-allowed" : "pointer",
              }}
            >
              {step.cta}
              <ArrowRight size={14} strokeWidth={2.5} />
            </button>

            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-tertiary)",
                  fontSize: 13,
                  cursor: "pointer",
                  padding: "8px 4px",
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                }}
              >
                Skip step
              </button>
            )}
          </div>

          {primaryHint && (
            <p
              style={{
                margin: "12px 0 0 0",
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "var(--text-tertiary)",
              }}
            >
              {primaryHint}
            </p>
          )}
        </>
      )}
    </div>
  );
}
