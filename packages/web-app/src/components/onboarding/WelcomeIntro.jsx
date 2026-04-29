/* WelcomeIntro — the rich body of the first journey card.
 *
 * Three short value pillars (Layered modeling · Git-native · AI-ready)
 * presented as compact icon cards, anchored by a one-line tagline. The
 * goal is to answer "what is this and why should I care" in five
 * seconds without burying the user in marketing copy.
 *
 * Lives next to JourneyStepCard.jsx, which special-cases the welcome
 * step to render this component instead of a plain <p>{step.body}</p>.
 *
 * Pure presentational — no state, no events.
 */
import React from "react";
import { Layers, GitBranch, Sparkles } from "lucide-react";

const PILLARS = [
  {
    icon: Layers,
    headline: "Layered modeling",
    tagline: "Concept → logical → physical → dbt SQL. One source of truth, business meaning included.",
    tint: "rgba(59, 130, 246, 0.18)",   // blue
    iconColor: "#60a5fa",
  },
  {
    icon: GitBranch,
    headline: "Git-native",
    tagline: "YAML in the repo your team already owns. Every change is a reviewable diff.",
    tint: "rgba(34, 197, 94, 0.18)",    // green
    iconColor: "#4ade80",
  },
  {
    icon: Sparkles,
    headline: "AI-ready",
    tagline: "Agents propose, you review. Modern analytics needs named, owned, described objects.",
    tint: "rgba(168, 85, 247, 0.18)",   // violet
    iconColor: "#c084fc",
  },
];

export default function WelcomeIntro() {
  return (
    <div style={{ margin: "0 0 18px 0" }}>
      <p
        style={{
          margin: "0 0 16px 0",
          fontSize: 15.5,
          lineHeight: 1.6,
          color: "var(--text-secondary)",
          fontWeight: 500,
        }}
      >
        Turn your dbt project into a <strong style={{ color: "var(--text-primary)" }}>governed, AI-ready model</strong> — without leaving Git.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 10,
        }}
      >
        {PILLARS.map(({ icon: Icon, headline, tagline, tint, iconColor }) => (
          <div
            key={headline}
            style={{
              padding: "14px 12px",
              borderRadius: 10,
              border: "1px solid var(--border-default)",
              background:
                `linear-gradient(180deg, ${tint} 0%, var(--bg-1) 60%)`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              transition: "transform 0.15s, border-color 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.borderColor = "var(--border-strong)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.borderColor = "var(--border-default)";
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 8,
                background: tint,
                color: iconColor,
              }}
            >
              <Icon size={15} strokeWidth={2.2} />
            </span>
            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                letterSpacing: "-0.005em",
                color: "var(--text-primary)",
              }}
            >
              {headline}
            </div>
            <div
              style={{
                fontSize: 11.5,
                lineHeight: 1.5,
                color: "var(--text-tertiary)",
              }}
            >
              {tagline}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
